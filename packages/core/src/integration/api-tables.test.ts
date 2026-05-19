/**
 * Integration tests for the /api/tables namespace (CRUD operations, single-project mode).
 *
 * Tests the full create → read → update → delete cycle against real
 * fixture schemas backed by in-memory SQLite. Tests within this file are
 * ordered intentionally — later tests depend on rows created by earlier tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createIntegrationApp, request, postJson, putJson, del } from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();
});

describe("/api/tables CRUD", () => {
  // ── Create → Read → Update → Delete cycle ──────────────────────────

  describe("accounts CRUD cycle", () => {
    let createdId: number;

    it("POST /api/tables/accounts creates a row", async () => {
      const res = await postJson("/api/tables/accounts", {
        name: "Cash",
        type: "asset",
        balance: 1000,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe("Cash");
      expect(body.data.type).toBe("asset");
      expect(body.data.balance).toBe(1000);
      expect(body.data.id).toBeGreaterThan(0);

      createdId = body.data.id;
    });

    it("GET /api/tables/accounts lists rows", async () => {
      const res = await request("/api/tables/accounts");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta).toBeDefined();
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/tables/accounts/:id returns a single row", async () => {
      const res = await request(`/api/tables/accounts/${createdId}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.id).toBe(createdId);
      expect(body.data.name).toBe("Cash");
    });

    it("PUT /api/tables/accounts/:id updates a row", async () => {
      const res = await putJson(`/api/tables/accounts/${createdId}`, {
        name: "Petty Cash",
        type: "asset",
        balance: 500,
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.name).toBe("Petty Cash");
      expect(body.data.balance).toBe(500);
    });

    it("DELETE /api/tables/accounts/:id deletes a row", async () => {
      const res = await del(`/api/tables/accounts/${createdId}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.id).toBe(createdId);

      const check = await request(`/api/tables/accounts/${createdId}`);
      expect(check.status).toBe(404);
    });
  });

  // ── Pagination ──────────────────────────────────────────────────────

  describe("pagination", () => {
    it("returns paginated results with meta.total", async () => {
      for (const name of ["Alpha", "Bravo", "Charlie"]) {
        await postJson("/api/tables/accounts", { name, type: "asset" });
      }

      const res = await request("/api/tables/accounts?limit=2&page=1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(3);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(2);
      expect(body.meta.pages).toBe(2);
    });
  });

  // ── Sorting ─────────────────────────────────────────────────────────

  describe("sorting", () => {
    it("sorts by name asc", async () => {
      const res = await request("/api/tables/accounts?sort=name");
      expect(res.status).toBe(200);

      const body = await res.json();
      const names = body.data.map((r: any) => r.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it("sorts by name desc", async () => {
      const res = await request("/api/tables/accounts?sort=-name");
      expect(res.status).toBe(200);

      const body = await res.json();
      const names = body.data.map((r: any) => r.name);
      const sorted = [...names].sort().reverse();
      expect(names).toEqual(sorted);
    });
  });

  // ── Filtering ───────────────────────────────────────────────────────

  describe("filtering", () => {
    it("filters by filter[type][eq]=asset", async () => {
      await postJson("/api/tables/accounts", {
        name: "Revenue Account",
        type: "revenue",
      });

      const res = await request("/api/tables/accounts?filter[type][eq]=asset");
      expect(res.status).toBe(200);

      const body = await res.json();
      for (const row of body.data) {
        expect(row.type).toBe("asset");
      }
      expect(body.data.some((r: any) => r.type === "revenue")).toBe(false);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects invalid select value with 422", async () => {
      const res = await postJson("/api/tables/accounts", {
        name: "Bad Account",
        type: "invalid_type",
      });
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.error).toBe("Validation failed");
      expect(body.details).toBeDefined();
    });

    it("rejects missing required field with 422", async () => {
      const res = await postJson("/api/tables/accounts", {
        type: "asset",
      });
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.error).toBe("Validation failed");
    });
  });

  // ── Immutable tables ───────────────────────────────────────────────

  describe("immutable tables", () => {
    it("POST to audit_log succeeds", async () => {
      const res = await postJson("/api/tables/audit_log", {
        event: "test_event",
        detail: "some detail",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.data.event).toBe("test_event");
    });

    it("PUT to audit_log returns 403", async () => {
      const createRes = await postJson("/api/tables/audit_log", {
        event: "immutable_test",
      });
      const id = (await createRes.json()).data.id;

      const res = await putJson(`/api/tables/audit_log/${id}`, {
        event: "modified",
      });
      expect(res.status).toBe(403);
    });

    it("DELETE from audit_log returns 403", async () => {
      const res = await del("/api/tables/audit_log/1");
      expect(res.status).toBe(403);
    });
  });

  // ── Lookup ──────────────────────────────────────────────────────────

  describe("lookup", () => {
    it("GET /api/tables/accounts/_lookup returns display values", async () => {
      const res = await request("/api/tables/accounts/_lookup");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(typeof body.data).toBe("object");

      const entries = Object.entries(body.data);
      expect(entries.length).toBeGreaterThan(0);
      for (const [id, display] of entries) {
        expect(typeof id).toBe("string");
        expect(typeof display).toBe("string");
      }
    });
  });

  // ── Search (cross-column q) ────────────────────────────────────────

  describe("search", () => {
    beforeAll(async () => {
      const rows = [
        { title: "Hono basics", body: "An intro to the Hono web framework", status: "published" },
        { title: "Drizzle tips", body: "Sharper typing for SQLite schemas", status: "published" },
        { title: "Secret notes", body: "Contains the word HONO in the body", status: "draft" },
        { title: "Unrelated", body: "Nothing to see here", status: "draft" },
      ];
      for (const row of rows) {
        await postJson("/api/tables/articles", row);
      }
    });

    it("filters rows where any searched column matches the substring (ILIKE)", async () => {
      const res = await request("/api/tables/articles?q=hono");
      expect(res.status).toBe(200);

      const body = await res.json();
      const titles = body.data.map((r: any) => r.title).sort();
      expect(titles).toEqual(["Hono basics", "Secret notes"]);
    });

    it("AND-composes search with filter[...] predicates", async () => {
      const res = await request(
        "/api/tables/articles?q=hono&filter[status][eq]=published",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      const titles = body.data.map((r: any) => r.title);
      expect(titles).toEqual(["Hono basics"]);
    });

    it("treats empty q as absent — returns all rows", async () => {
      const res = await request("/api/tables/articles?q=");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(4);
    });

    it("returns 400 when q is set but the table has no search config", async () => {
      const res = await request("/api/tables/accounts?q=foo");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.code).toBe("no_search_config");
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("GET /api/tables/nonexistent returns 404", async () => {
      const res = await request("/api/tables/nonexistent");
      expect(res.status).toBe(404);
    });

    it("GET /api/tables/accounts/999 returns 404", async () => {
      const res = await request("/api/tables/accounts/999");
      expect(res.status).toBe(404);
    });
  });

  // ── UUID / text primary keys ────────────────────────────────────────
  //
  // The `agents` fixture has a bare `text` PK with no DB-side default, so the
  // client must supply the id (a UUID). This cycle exercises the full CRUD
  // path with a non-numeric id end-to-end so a future regression that
  // re-introduces `Number(id)` somewhere in the stack will fail here.

  describe("agents (UUID PK) CRUD cycle", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440001";
    const uuid2 = "550e8400-e29b-41d4-a716-446655440002";

    it("POST creates a row with a client-supplied UUID", async () => {
      const res = await postJson("/api/tables/agents", {
        id: uuid1,
        name: "Alpha",
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe(uuid1);
      expect(body.data.name).toBe("Alpha");
    });

    it("GET /:id returns the UUID-keyed row", async () => {
      const res = await request(`/api/tables/agents/${uuid1}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(uuid1);
    });

    it("PUT /:id updates a UUID-keyed row", async () => {
      const res = await putJson(`/api/tables/agents/${uuid1}`, {
        name: "Alpha Renamed",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Alpha Renamed");
    });

    it("_lookup?ids=<uuid1>,<uuid2> returns labels keyed by UUID", async () => {
      await postJson("/api/tables/agents", { id: uuid2, name: "Bravo" });
      const res = await request(
        `/api/tables/agents/_lookup?ids=${uuid1},${uuid2}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data[uuid1]).toBe("Alpha Renamed");
      expect(body.data[uuid2]).toBe("Bravo");
    });

    it("POST without an id is rejected (no DB default for text PK)", async () => {
      const res = await postJson("/api/tables/agents", { name: "No ID" });
      expect(res.status).toBe(422);
    });

    it("DELETE /:id removes the UUID-keyed row", async () => {
      const res = await del(`/api/tables/agents/${uuid1}`);
      expect(res.status).toBe(200);
      const check = await request(`/api/tables/agents/${uuid1}`);
      expect(check.status).toBe(404);
    });
  });
});
