/**
 * Integration tests for the /api/meta namespace (single-project mode).
 *
 * The meta namespace exposes schema introspection, DB introspection,
 * and a SQL escape hatch.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createIntegrationApp, request, postJson } from "./setup.js";

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
      expect(names).toEqual(["accounts", "agents", "articles", "audit_log", "journal_entries"]);

      const accounts = body.tables.find((t: any) => t.name === "accounts");
      expect(accounts.label).toBe("Accounts");
      expect(accounts.columns.length).toBeGreaterThan(0);
      expect(accounts.rowCount).toBeGreaterThanOrEqual(0);
    });

    it("GET /api/meta/tables/accounts returns single table with columns and selects", async () => {
      const res = await request("/api/meta/tables/accounts");
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
      expect(typeCol.select.options).toEqual(
        ["asset", "liability", "equity", "revenue", "expense"],
      );
    });

    it("GET /api/meta/tables/nonexistent returns 404", async () => {
      const res = await request("/api/meta/tables/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ── DB introspection ──────────────────────────────────────────────

  describe("DB introspection", () => {
    it("GET /api/meta/tables/accounts/indexes returns index list", async () => {
      const res = await request("/api/meta/tables/accounts/indexes");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("GET /api/meta/tables/accounts/sample returns sample rows", async () => {
      await postJson("/api/tables/accounts", { name: "SampleAccount", type: "asset" });

      const res = await request("/api/meta/tables/accounts/sample");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });

    it("GET /api/meta/enums returns 404 (SQLite has no native enum type)", async () => {
      const res = await request("/api/meta/enums");
      expect(res.status).toBe(404);
    });
  });

  // ── SQL proxy ─────────────────────────────────────────────────────

  describe("SQL proxy", () => {
    it("POST /api/meta/sql runs a SELECT", async () => {
      await postJson("/api/tables/accounts", { name: "SQLTestAccount", type: "equity" });

      const res = await postJson("/api/meta/sql", {
        sql: "SELECT name, type FROM accounts WHERE type = 'equity'",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].name).toBe("SQLTestAccount");
    });

    it("POST /api/meta/sql runs an INSERT and a follow-up SELECT sees it", async () => {
      const res = await postJson("/api/meta/sql", {
        sql: "INSERT INTO accounts (name, type) VALUES ('ExecTest', 'liability')",
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
  });
});
