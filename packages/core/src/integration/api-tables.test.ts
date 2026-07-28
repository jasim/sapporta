/**
 * Integration tests for the /api/tables namespace (table operations, single-project mode).
 *
 * Tests the full create → read → update → delete cycle against real
 * fixture schemas backed by in-memory SQLite. Tests within this file are
 * ordered intentionally — later tests depend on rows created by earlier tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  asAuth,
  createIntegrationApp,
  request,
  postJson,
  putJson,
  del,
} from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();
});

describe("/api/tables table operations", () => {
  // ── Create → Read → Update → Delete cycle ──────────────────────────

  describe("accounts table-operation cycle", () => {
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

  describe("read query boundaries", () => {
    it("rejects unknown list parameters instead of silently ignoring them", async () => {
      const res = await request("/api/tables/accounts?srot=name");

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "bad_value" });
    });

    it("rejects malformed filter grammar instead of widening the read", async () => {
      const res = await request("/api/tables/accounts?filter%5Bname%5D=unsafe");

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "unknown_filter_shape",
      });
    });

    it("exports the complete selection and rejects pagination parameters", async () => {
      const exported = await request(
        "/api/tables/accounts/export.csv?sort=name&filter[type][eq]=asset",
      );
      expect(exported.status).toBe(200);
      expect(exported.headers.get("content-type")).toContain("text/csv");
      expect(await exported.text()).toContain("Alpha");

      const paged = await request("/api/tables/accounts/export.csv?page=2");
      expect(paged.status).toBe(400);
      expect(await paged.json()).toMatchObject({ code: "bad_value" });
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

    it("AND-combines repeated filters with the same column and operator", async () => {
      const left = "repeat-left-9d";
      const right = "repeat-right-7q";
      for (const name of [`${left} ${right}`, left, right]) {
        const created = await postJson("/api/tables/accounts", {
          name,
          type: "asset",
        });
        expect(created.status).toBe(201);
      }

      const key = "filter%5Bname%5D%5Bcontains%5D";
      const res = await request(
        `/api/tables/accounts?${key}=${left}&${key}=${right}`,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ name: string }>;
      };
      expect(body.data.map((row) => row.name)).toEqual([`${left} ${right}`]);
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
      expect(body.code).toBe("VALIDATION_FAILED");
    });

    it("rejects empty batch inserts with 422", async () => {
      const res = await postJson("/api/tables/accounts", []);
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body).toMatchObject({
        error: "Validation failed",
        code: "VALIDATION_FAILED",
      });
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
      expect(Array.isArray(body.entries)).toBe(true);

      const entries = body.entries as Array<{
        value: unknown;
        label: unknown;
        meta: unknown;
      }>;
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(
          typeof entry.value === "string" || typeof entry.value === "number",
        ).toBe(true);
        expect(typeof entry.label).toBe("string");
        expect(entry.meta).toEqual(expect.any(Object));
        expect(entry.meta).not.toHaveProperty("workspace_id");
        expect(entry.meta).not.toHaveProperty("scoped_to_user_id");
        expect(entry.meta).not.toHaveProperty("created_at");
        expect(entry.meta).not.toHaveProperty("updated_at");
      }
    });

    it("searches the label and only extra fields displayed by the picker", async () => {
      const created = await postJson("/api/tables/accounts", {
        name: "Lookup Boundary Probe",
        type: "expense",
        balance: 987654,
      });
      expect(created.status).toBe(201);

      const labelSearch = await request(
        "/api/tables/accounts/_lookup?q=boundary",
      );
      expect(labelSearch.status).toBe(200);
      expect((await labelSearch.json()).entries).toHaveLength(1);

      const undisplayedFieldSearch = await request(
        "/api/tables/accounts/_lookup?q=987654",
      );
      expect(undisplayedFieldSearch.status).toBe(200);
      expect((await undisplayedFieldSearch.json()).entries).toEqual([]);

      const displayedFieldSearch = await request(
        "/api/tables/accounts/_lookup?q=987654&fields=balance",
      );
      expect(displayedFieldSearch.status).toBe(200);
      expect((await displayedFieldSearch.json()).entries).toMatchObject([
        { label: "Lookup Boundary Probe", meta: { balance: 987654 } },
      ]);
    });

    it("rejects hidden fields as picker search fields", async () => {
      const res = await request(
        "/api/tables/accounts/_lookup?q=workspace-1&fields=workspace_id",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "unknown_column" });
    });

    it("rejects contradictory and empty ID lookup modes", async () => {
      for (const query of [
        "ids=1&q=cash",
        "ids=1&fields=name",
        "ids=1&limit=1",
        "ids=%2C%2C%2C",
      ]) {
        const res = await request(`/api/tables/accounts/_lookup?${query}`);
        expect(res.status, query).toBe(400);
        expect(await res.json(), query).toMatchObject({
          code: "BAD_REQUEST",
        });
      }
    });
  });

  // ── Search (cross-column q) ────────────────────────────────────────

  describe("search", () => {
    beforeAll(async () => {
      const rows = [
        {
          title: "Hono basics",
          body: "An intro to the Hono web framework",
          status: "published",
        },
        {
          title: "Drizzle tips",
          body: "Sharper typing for SQLite schemas",
          status: "published",
        },
        {
          title: "Secret notes",
          body: "Contains the word HONO in the body",
          status: "draft",
        },
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

    it("returns 400 when table search is explicitly disabled", async () => {
      const res = await request("/api/tables/accounts?q=foo");
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.code).toBe("no_search_config");
    });

    it("accepts q on a table with default search configuration", async () => {
      const res = await request("/api/tables/agents?q=alpha");
      expect(res.status).toBe(200);
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
  // client must supply the id (a UUID). This cycle exercises the full table
  // path with a non-numeric id end-to-end so a future regression that
  // re-introduces `Number(id)` somewhere in the stack will fail here.

  describe("agents (UUID PK) table-operation cycle", () => {
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
      expect(body.entries).toEqual([
        {
          value: uuid1,
          label: "Alpha Renamed",
          meta: {
            id: uuid1,
            name: "Alpha Renamed",
          },
        },
        {
          value: uuid2,
          label: "Bravo",
          meta: {
            id: uuid2,
            name: "Bravo",
          },
        },
      ]);
    });

    it("POST duplicate UUID returns 409", async () => {
      const res = await postJson("/api/tables/agents", {
        id: uuid2,
        name: "Duplicate Bravo",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT" });
    });

    it("PUT duplicate UUID returns 409", async () => {
      const res = await putJson(`/api/tables/agents/${uuid1}`, {
        id: uuid2,
        name: "Alpha Conflicts",
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT" });
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

  describe("auth row scopes", () => {
    it("stamps workspace-global rows and hides them from other workspaces", async () => {
      const workspaceTwo = asAuth({ workspaceId: "workspace-2" });
      const createRes = await workspaceTwo.postJson("/api/tables/accounts", {
        name: "Workspace Two Cash",
        type: "asset",
        balance: 200,
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        data: { id: number; name: string; workspace_id: string };
      };
      expect(created.data.workspace_id).toBe("workspace-2");

      const defaultWorkspaceGet = await request(
        `/api/tables/accounts/${created.data.id}`,
      );
      expect(defaultWorkspaceGet.status).toBe(404);

      const workspaceTwoList = await workspaceTwo.request(
        "/api/tables/accounts",
      );
      expect(workspaceTwoList.status).toBe(200);
      const workspaceTwoBody = (await workspaceTwoList.json()) as {
        data: Array<{ name: string; workspace_id: string }>;
      };
      expect(workspaceTwoBody.data).toContainEqual(
        expect.objectContaining({
          name: "Workspace Two Cash",
          workspace_id: "workspace-2",
        }),
      );
    });

    it("rejects API-submitted ownership fields", async () => {
      const res = await postJson("/api/tables/articles", {
        title: "Tamper",
        body: "Client attempted to set ownership",
        status: "draft",
        workspace_id: "workspace-2",
        scoped_to_user_id: "user-2",
      });
      expect(res.status).toBe(422);

      const body = (await res.json()) as {
        code: string;
        details: Array<{ field: string }>;
      };
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(body.details.map((detail) => detail.field)).toEqual(
        expect.arrayContaining(["workspace_id", "scoped_to_user_id"]),
      );
    });

    it("stamps user-scoped rows without widening owner route visibility", async () => {
      const userOneCreate = await postJson("/api/tables/articles", {
        title: "User One Draft",
        body: "Visible in workspace one",
        status: "draft",
      });
      expect(userOneCreate.status).toBe(201);
      const userOneArticle = (await userOneCreate.json()) as {
        data: {
          title: string;
          workspace_id: string;
          scoped_to_user_id: string;
        };
      };
      expect(userOneArticle.data.workspace_id).toBe("workspace-1");
      expect(userOneArticle.data.scoped_to_user_id).toBe("user-1");

      const userTwo = asAuth({ userId: "user-2" });
      const userTwoCreate = await userTwo.postJson("/api/tables/articles", {
        title: "User Two Draft",
        body: "Same workspace, different user",
        status: "draft",
      });
      expect(userTwoCreate.status).toBe(201);
      const userTwoArticle = (await userTwoCreate.json()) as {
        data: {
          title: string;
          workspace_id: string;
          scoped_to_user_id: string;
        };
      };
      expect(userTwoArticle.data.workspace_id).toBe("workspace-1");
      expect(userTwoArticle.data.scoped_to_user_id).toBe("user-2");

      const defaultList = await request(
        "/api/tables/articles?filter[status][eq]=draft",
      );
      expect(defaultList.status).toBe(200);
      const defaultBody = (await defaultList.json()) as {
        data: Array<{ title: string }>;
      };
      const defaultTitles = defaultBody.data.map((row) => row.title);
      expect(defaultTitles).toContain("User One Draft");
      expect(defaultTitles).not.toContain("User Two Draft");

      const userTwoMemberList = await userTwo.request(
        "/api/tables/articles?filter[status][eq]=draft",
      );
      expect(userTwoMemberList.status).toBe(200);
      const userTwoMemberBody = (await userTwoMemberList.json()) as {
        data: Array<{ title: string }>;
      };
      const userTwoTitles = userTwoMemberBody.data.map((row) => row.title);
      expect(userTwoTitles).toContain("User Two Draft");
      expect(userTwoTitles).not.toContain("User One Draft");

      const otherWorkspace = asAuth({ workspaceId: "workspace-2" });
      const otherWorkspaceList = await otherWorkspace.request(
        "/api/tables/articles",
      );
      expect(otherWorkspaceList.status).toBe(200);
      const otherWorkspaceBody = (await otherWorkspaceList.json()) as {
        data: Array<{ title: string }>;
      };
      expect(otherWorkspaceBody.data.map((row) => row.title)).not.toEqual(
        expect.arrayContaining(["User One Draft", "User Two Draft"]),
      );
    });

    it("validates references inside the active auth boundary", async () => {
      const accountRes = await postJson("/api/tables/accounts", {
        name: "Journal Boundary Account",
        type: "asset",
      });
      expect(accountRes.status).toBe(201);
      const account = (await accountRes.json()) as { data: { id: number } };

      const sameWorkspaceJournal = await postJson(
        "/api/tables/journal_entries",
        {
          account_id: account.data.id,
          description: "Visible account reference",
          amount: 50,
        },
      );
      expect(sameWorkspaceJournal.status).toBe(201);
      const journal = (await sameWorkspaceJournal.json()) as {
        data: {
          account_id: number;
          workspace_id: string;
          scoped_to_user_id: string;
        };
      };
      expect(journal.data.account_id).toBe(account.data.id);
      expect(journal.data.workspace_id).toBe("workspace-1");
      expect(journal.data.scoped_to_user_id).toBe("user-1");

      const crossWorkspaceJournal = await postJson(
        "/api/tables/journal_entries",
        {
          account_id: account.data.id,
          description: "Hidden account reference",
          amount: 75,
        },
        { workspaceId: "workspace-2" },
      );
      expect(crossWorkspaceJournal.status).toBe(422);
      const error = (await crossWorkspaceJournal.json()) as {
        details: Array<{ field: string; message: string }>;
      };
      expect(error.details).toContainEqual(
        expect.objectContaining({
          field: "account_id",
          message:
            "Referenced row does not exist or is not visible in the active request scope.",
        }),
      );
    });
  });

  describe("count reads", () => {
    it("filters and groups counts inside user row scope", async () => {
      const accountResponse = await postJson("/api/tables/accounts", {
        name: "Count Scope Account",
        type: "asset",
      });
      expect(accountResponse.status).toBe(201);
      const account = (await accountResponse.json()) as {
        data: { id: number };
      };

      for (const description of [
        "Count scope user one A",
        "Count scope user one B",
      ]) {
        expect(
          (
            await postJson("/api/tables/journal_entries", {
              account_id: account.data.id,
              description,
              amount: 10,
            })
          ).status,
        ).toBe(201);
      }
      const userTwo = asAuth({ userId: "aggregate-user-2" });
      for (const description of [
        "Count scope user two A",
        "Count scope user two B",
        "Count scope user two C",
      ]) {
        expect(
          (
            await userTwo.postJson("/api/tables/journal_entries", {
              account_id: account.data.id,
              description,
              amount: 20,
            })
          ).status,
        ).toBe(201);
      }

      const query =
        "?filter[description][startswith]=Count%20scope" +
        "&filter[account_id][is]=notnull" +
        "&group_by=account_id" +
        "&limit=10";
      const userOneResponse = await request(
        `/api/tables/journal_entries/_count${query}`,
      );
      expect(userOneResponse.status).toBe(200);
      expect(await userOneResponse.json()).toEqual({
        data: {
          kind: "grouped",
          groups: [{ value: account.data.id, count: 2 }],
        },
      });

      const userTwoResponse = await userTwo.request(
        `/api/tables/journal_entries/_count${query}`,
      );
      expect(userTwoResponse.status).toBe(200);
      expect(await userTwoResponse.json()).toEqual({
        data: {
          kind: "grouped",
          groups: [{ value: account.data.id, count: 3 }],
        },
      });

      const totalResponse = await request(
        "/api/tables/journal_entries/_count" +
          "?filter[description][startswith]=Count%20scope",
      );
      expect(totalResponse.status).toBe(200);
      expect(await totalResponse.json()).toEqual({
        data: { kind: "total", count: 2 },
      });
    });

    it("returns structured 400 errors for invalid count requests", async () => {
      const requests = [
        "/api/tables/accounts/_count?group_by=missing",
        "/api/tables/accounts/_count?filter[type][like]=asset",
        "/api/tables/accounts/_count?group_by=type&order=sideways",
        "/api/tables/accounts/_count?limit=1",
        "/api/tables/accounts/_count?group_by=type&limit=1001",
      ];
      for (const path of requests) {
        const response = await request(path);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(
          expect.objectContaining({
            error: expect.any(String),
            code: expect.any(String),
          }),
        );
      }
    });
  });
});
