/**
 * Tests for CLI route registration and Commander-based routing.
 *
 * The first describe block verifies that ROUTES patterns correctly resolve
 * to the expected HTTP method + path by matching fixed segments.
 *
 * The second describe block does a round-trip test against the single-project
 * app (no /p/:slug prefix).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { ROUTES } from "../cli/routes.js";
import type { CliRoute } from "../cli/routes.js";
import { createIntegrationApp, request } from "./setup.js";

// ── Helper: find a route by its fixed segments ──────────────────────
function findRoute(fixedSegments: string[]): CliRoute | undefined {
  const key = fixedSegments.join(" ");
  return ROUTES.find((r) => {
    const fixed = r.pattern.filter((t) => !t.startsWith(":")).join(" ");
    return fixed === key;
  });
}

// ── Route table verification (no DB needed) ─────────────────────────

describe("CLI route table", () => {
  it("meta tables → GET /api/meta/tables", () => {
    const route = findRoute(["meta", "tables"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables");
    expect(route!.method).toBe("GET");
  });

  it("meta tables indexes → GET /api/meta/tables/:name/indexes", () => {
    const route = findRoute(["meta", "tables", "indexes"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:name/indexes");
    expect(route!.params).toEqual(["name"]);
  });

  it("meta tables sample → GET /api/meta/tables/:name/sample", () => {
    const route = findRoute(["meta", "tables", "sample"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:name/sample");
    expect(route!.params).toEqual(["name"]);
  });

  it("meta tables show → GET /api/meta/tables/:name", () => {
    const route = findRoute(["meta", "tables", "show"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:name");
    expect(route!.method).toBe("GET");
  });

  it("meta sql → POST /api/meta/sql", () => {
    const route = findRoute(["meta", "sql"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/sql");
    expect(route!.method).toBe("POST");
  });

  it("meta schema sync → POST /api/meta/schema/sync", () => {
    const route = findRoute(["meta", "schema", "sync"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/schema/sync");
    expect(route!.method).toBe("POST");
  });

  it("tables list → GET /api/tables/:table", () => {
    const route = findRoute(["tables", "list"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table");
    expect(route!.method).toBe("GET");
    expect(route!.params).toEqual(["table"]);
  });

  it("tables add-row → POST /api/tables/:table", () => {
    const route = findRoute(["tables", "add-row"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table");
    expect(route!.method).toBe("POST");
    expect(route!.params).toEqual(["table"]);
  });

  it("tables update → PUT /api/tables/:table/:id", () => {
    const route = findRoute(["tables", "update"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table/:id");
    expect(route!.method).toBe("PUT");
    expect(route!.params).toEqual(["table", "id"]);
  });

  it("tables delete → DELETE /api/tables/:table/:id", () => {
    const route = findRoute(["tables", "delete"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table/:id");
    expect(route!.method).toBe("DELETE");
    expect(route!.params).toEqual(["table", "id"]);
  });

  it("reports → GET /api/reports", () => {
    const route = findRoute(["reports"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/reports");
    expect(route!.method).toBe("GET");
  });

  it("reports run → GET /api/reports/:name/results", () => {
    const route = findRoute(["reports", "run"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/reports/:name/results");
    expect(route!.method).toBe("GET");
  });

});

// ── CLI route → HTTP round-trip (single-project, no /p/:slug) ───────

describe("CLI route → HTTP round-trip", () => {
  beforeAll(async () => {
    await createIntegrationApp();
  });

  it("meta tables → GET /api/meta/tables → 200 with table list", async () => {
    const route = findRoute(["meta", "tables"]);
    expect(route).toBeDefined();

    const res = await request(route!.path);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tables).toBeDefined();
    expect(body.tables.length).toBeGreaterThan(0);
  });

  it("tables list accounts → GET /api/tables/accounts → 200 with rows", async () => {
    const route = findRoute(["tables", "list"]);
    expect(route).toBeDefined();

    const path = route!.path.replace(":table", "accounts");
    const res = await request(path);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
