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
import { Command } from "commander";
import { ROUTES, registerRoutes } from "../cli/routes.js";
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
  it("tables → GET /api/meta/tables", () => {
    const route = findRoute(["tables"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables");
    expect(route!.method).toBe("GET");
  });

  it("tables indexes → GET /api/meta/tables/:table/indexes", () => {
    const route = findRoute(["tables", "indexes"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:table/indexes");
    expect(route!.params).toEqual(["table"]);
  });

  it("tables sample → GET /api/meta/tables/:table/sample", () => {
    const route = findRoute(["tables", "sample"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:table/sample");
    expect(route!.params).toEqual(["table"]);
  });

  it("tables show → GET /api/meta/tables/:table", () => {
    const route = findRoute(["tables", "show"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/tables/:table");
    expect(route!.method).toBe("GET");
  });

  it("enums → GET /api/meta/enums", () => {
    const route = findRoute(["enums"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/enums");
    expect(route!.method).toBe("GET");
  });

  it("db exec-sql → POST /api/meta/sql", () => {
    const route = findRoute(["db", "exec-sql"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/meta/sql");
    expect(route!.method).toBe("POST");
  });

  it("schema sync is not a Sapporta command", () => {
    expect(findRoute(["schema", "sync"])).toBeUndefined();
  });

  it("rows → GET /api/tables/:table", () => {
    const route = findRoute(["rows"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table");
    expect(route!.method).toBe("GET");
    expect(route!.params).toEqual(["table"]);
  });

  it("rows insert → POST /api/tables/:table", () => {
    const route = findRoute(["rows", "insert"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table");
    expect(route!.method).toBe("POST");
    expect(route!.params).toEqual(["table"]);
  });

  it("rows update → PUT /api/tables/:table/:id", () => {
    const route = findRoute(["rows", "update"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table/:id");
    expect(route!.method).toBe("PUT");
    expect(route!.params).toEqual(["table", "id"]);
  });

  it("rows delete → DELETE /api/tables/:table/:id", () => {
    const route = findRoute(["rows", "delete"]);
    expect(route).toBeDefined();
    expect(route!.path).toBe("/api/tables/:table/:id");
    expect(route!.method).toBe("DELETE");
    expect(route!.params).toEqual(["table", "id"]);
  });

  it("reports are not registry-backed CLI commands", () => {
    expect(findRoute(["reports"])).toBeUndefined();
    expect(findRoute(["reports", "run"])).toBeUndefined();
  });
});

describe("CLI route registration", () => {
  function registeredProgram(
    handler: Parameters<typeof registerRoutes>[2] = async () => {},
  ) {
    const program = new Command("sapporta").exitOverride();
    registerRoutes(program, ROUTES, handler);
    return program;
  }

  async function parseCommand(args: string[]) {
    const calls: Array<{
      route: CliRoute;
      params: Record<string, string>;
      extraPositionals: string[];
    }> = [];
    const program = registeredProgram(
      async (route, params, extraPositionals) => {
        calls.push({ route, params, extraPositionals });
      },
    );
    await program.parseAsync(args, { from: "user" });
    return calls;
  }

  it("routes bare tables to the table catalog command", async () => {
    const calls = await parseCommand(["tables"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].route.pattern).toEqual(["tables"]);
    expect(calls[0].params).toEqual({});
  });

  it("routes rows <table> to row listing without hiding rows subcommands", async () => {
    const listCalls = await parseCommand(["rows", "accounts"]);
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].route.pattern).toEqual(["rows", ":table"]);
    expect(listCalls[0].params).toEqual({ table: "accounts" });

    const getCalls = await parseCommand(["rows", "get", "accounts", "1"]);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].route.pattern).toEqual(["rows", "get", ":table", ":id"]);
    expect(getCalls[0].params).toEqual({ table: "accounts", id: "1" });
  });
});

// ── CLI route → HTTP round-trip (single-project, no /p/:slug) ───────

describe("CLI route → HTTP round-trip", () => {
  beforeAll(async () => {
    await createIntegrationApp();
  });

  it("tables → GET /api/meta/tables → 200 with table list", async () => {
    const route = findRoute(["tables"]);
    expect(route).toBeDefined();

    const res = await request(route!.path);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tables).toBeDefined();
    expect(body.tables.length).toBeGreaterThan(0);
  });

  it("rows accounts → GET /api/tables/accounts → 200 with rows", async () => {
    const route = findRoute(["rows"]);
    expect(route).toBeDefined();

    const path = route!.path.replace(":table", "accounts");
    const res = await request(path);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
