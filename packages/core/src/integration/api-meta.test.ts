/**
 * Integration tests for the /api/meta namespace (single-project mode).
 *
 * The meta namespace exposes schema introspection, DB introspection,
 * and a SQL escape hatch.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { asAuth, createIntegrationApp, request, postJson } from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();
});

describe("/api/meta", () => {
  // ── Schema introspection ──────────────────────────────────────────

  describe("schema introspection", () => {
    it("GET /api/meta/tables lists all tables with structure", async () => {
      const res = await request("/api/meta/tables");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.tables).toBeDefined();
      // 5 fixture schemas: accounts, agents, articles, audit_log, journal_entries
      expect(body.tables).toHaveLength(5);

      const names = body.tables.map((t: any) => t.name).sort();
      expect(names).toEqual([
        "accounts",
        "agents",
        "articles",
        "audit_log",
        "journal_entries",
      ]);

      const accounts = body.tables.find((t: any) => t.name === "accounts");
      expect(accounts.label).toBe("Accounts");
      expect(accounts.columns.length).toBeGreaterThan(0);
      expect(accounts.rowCount).toBeGreaterThanOrEqual(0);
    });

    it("GET /api/meta/tables omits row counts for ordinary callers", async () => {
      const ordinary = asAuth({ isOwner: false });

      const res = await ordinary.request("/api/meta/tables");
      expect(res.status).toBe(200);

      const body = await res.json();
      const accounts = body.tables.find(
        (table: { name: string }) => table.name === "accounts",
      );
      expect(accounts).toBeDefined();
      expect(accounts).not.toHaveProperty("rowCount");
    });

    it("GET /api/meta/tables/accounts returns single table with columns and selects", async () => {
      const ordinary = asAuth({ isOwner: false });

      const res = await ordinary.request("/api/meta/tables/accounts");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("accounts");
      expect(body.label).toBe("Accounts");
      expect(body.immutable).toBe(false);

      const colNames = body.columns.map((c: any) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
      expect(colNames).toContain("type");
      expect(colNames).toContain("balance");

      const typeCol = body.columns.find((c: any) => c.name === "type");
      expect(typeCol.select).toBeDefined();
      expect(typeCol.select.options).toEqual([
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense",
      ]);
    });

    it("GET /api/meta/tables/nonexistent returns 404", async () => {
      const res = await request("/api/meta/tables/nonexistent");
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'Table "nonexistent" not found',
        code: "TABLE_NOT_FOUND",
      });
    });
  });

  // ── DB introspection ──────────────────────────────────────────────

  describe("DB introspection", () => {
    it("GET /api/meta/tables?detail=full rejects ordinary callers", async () => {
      const ordinary = asAuth({ isOwner: false });

      const res = await ordinary.request("/api/meta/tables?detail=full");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Forbidden",
        code: "forbidden",
      });
    });

    it("GET /api/meta/tables?detail=full allows elevated callers", async () => {
      const res = await request("/api/meta/tables?detail=full");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0].table_name).toBeDefined();
    });

    it("GET /api/meta/tables/accounts/indexes rejects ordinary callers", async () => {
      const ordinary = asAuth({ isOwner: false });

      const res = await ordinary.request("/api/meta/tables/accounts/indexes");
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Forbidden",
        code: "forbidden",
      });
    });

    it("GET /api/meta/tables/accounts/indexes returns index list", async () => {
      const res = await request("/api/meta/tables/accounts/indexes");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/meta/tables/nonexistent/indexes returns 404", async () => {
      const res = await request("/api/meta/tables/nonexistent/indexes");
      expect(res.status).toBe(404);

      expect(await res.json()).toEqual({
        error: "Table 'nonexistent' not found",
        code: "TABLE_NOT_FOUND",
      });
    });

    it("GET /api/meta/tables/accounts/sample returns sample rows", async () => {
      await postJson("/api/tables/accounts", {
        name: "SampleAccount",
        type: "asset",
      });

      const res = await request("/api/meta/tables/accounts/sample");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it("GET /api/meta/tables/accounts/sample trims requested fields", async () => {
      await postJson("/api/tables/accounts", {
        name: "FieldTrimAccount",
        type: "asset",
      });

      const res = await request(
        "/api/meta/tables/accounts/sample?fields=name,%20type&limit=1",
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Object.keys(body[0]).sort()).toEqual(["name", "type"]);
    });

    it("GET /api/meta/tables/accounts/sample rejects bad limits", async () => {
      for (const limit of ["abc", "0", "-1", "1.9"]) {
        const res = await request(
          `/api/meta/tables/accounts/sample?limit=${encodeURIComponent(limit)}`,
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "BAD_LIMIT" });
      }
    });

    it("GET /api/meta/tables/nonexistent/sample returns 404", async () => {
      const res = await request("/api/meta/tables/nonexistent/sample");
      expect(res.status).toBe(404);

      expect(await res.json()).toEqual({
        error: "Table 'nonexistent' not found",
        code: "TABLE_NOT_FOUND",
      });
    });

    it("GET /api/meta/enums returns 404 (SQLite has no native enum type)", async () => {
      const res = await request("/api/meta/enums");
      expect(res.status).toBe(404);
    });
  });

  // ── SQL proxy ─────────────────────────────────────────────────────

  describe("SQL proxy", () => {
    it("POST /api/meta/sql runs a SELECT", async () => {
      await postJson("/api/tables/accounts", {
        name: "SQLTestAccount",
        type: "equity",
      });

      const res = await postJson("/api/meta/sql", {
        sql: "SELECT name, type FROM accounts WHERE type = 'equity'",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].name).toBe("SQLTestAccount");
    });

    it("POST /api/meta/sql returns 403 without unrestricted access", async () => {
      const res = await postJson(
        "/api/meta/sql",
        {
          sql: "SELECT name FROM accounts",
        },
        { canManageUnrestrictedAccess: false },
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Forbidden",
        code: "forbidden",
      });
    });

    it("POST /api/meta/sql binds params", async () => {
      await postJson("/api/tables/accounts", {
        name: "BoundParamAccount",
        type: "asset",
      });

      const res = await postJson("/api/meta/sql", {
        sql: "SELECT name FROM accounts WHERE name = ?",
        params: ["BoundParamAccount"],
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual([{ name: "BoundParamAccount" }]);
    });

    it("POST /api/meta/sql rejects an INSERT without allowDangerous", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "INSERT INTO accounts (name, type, workspace_id) VALUES ('RejectedExecTest', 'liability', 'workspace-1')",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "SELECT_ONLY" });

      const check = await postJson("/api/meta/sql", {
        sql: "SELECT name FROM accounts WHERE name = 'RejectedExecTest'",
      });
      const rows = await check.json();
      expect(rows).toHaveLength(0);
    });

    it("POST /api/meta/sql runs an INSERT with allowDangerous", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "INSERT INTO accounts (name, type, workspace_id) VALUES ('ExecTest', 'liability', 'workspace-1')",
        allowDangerous: true,
      });
      expect(res.status).toBe(200);

      const check = await postJson("/api/meta/sql", {
        sql: "SELECT name FROM accounts WHERE name = 'ExecTest'",
      });
      const rows = await check.json();
      expect(rows.length).toBe(1);
    });

    it("POST /api/meta/sql rejects dangerous statements", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "DROP DATABASE sapporta",
      });
      expect(res.status).toBe(400);
    });

    it("POST /api/meta/sql rejects DROP TABLE", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "DROP TABLE accounts",
        allowDangerous: true,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "DANGEROUS_SQL" });
    });

    it("POST /api/meta/sql classifies SQL syntax errors as 400", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "SELECT FROM",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_SQL" });
    });

    it("POST /api/meta/sql classifies unique conflicts as 409", async () => {
      const first = await postJson("/api/meta/sql", {
        sql: "INSERT INTO agents (id, name, workspace_id) VALUES (?, ?, ?)",
        params: ["agent-conflict", "First", "workspace-1"],
        allowDangerous: true,
      });
      expect(first.status).toBe(200);

      const second = await postJson("/api/meta/sql", {
        sql: "INSERT INTO agents (id, name, workspace_id) VALUES (?, ?, ?)",
        params: ["agent-conflict", "Second", "workspace-1"],
        allowDangerous: true,
      });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: "CONFLICT" });
    });

    it("GET /api/meta/tables treats catalog/database drift as a 500", async () => {
      const { conn } = await createIntegrationApp();
      conn.sqlite.exec("DROP TABLE accounts");

      const res = await request("/api/meta/tables");
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ code: "INTERNAL" });
    });
  });
});
