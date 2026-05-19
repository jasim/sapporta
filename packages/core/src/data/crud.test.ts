import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { crud } from "./crud.js";
import { createTestDb } from "../testing/test-utils.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  balance: integer("balance"),
});

const accounts = table({
  drizzle: accountsTable,
  meta: {
    selects: [
      {
        type: "select",
        column: "type",
        options: ["asset", "liability", "equity", "revenue", "expense"],
      },
    ],
  },
});

describe("CRUD sub-app", () => {
  let app: Hono;

  beforeEach(async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance INTEGER
      )
    `);

    app = new Hono();
    app.route("/api/accounts", crud(accounts, db));
  });

  it("POST / creates a record", async () => {
    const res = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset" }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.name).toBe("Cash");
    expect(json.data.type).toBe("asset");
    expect(json.data.id).toBe(1);
  });

  it("POST / validates input", async () => {
    const res = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad", type: "invalid" }),
    });

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
  });

  it("GET / lists records with pagination", async () => {
    // Insert two records
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset" }),
    });
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Revenue", type: "revenue" }),
    });

    const res = await app.request("/api/accounts");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.meta.total).toBe(2);
    expect(json.meta.page).toBe(1);
  });

  it("GET /:id returns single record", async () => {
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset" }),
    });

    const res = await app.request("/api/accounts/1");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Cash");
  });

  it("GET /:id returns 404 for missing record", async () => {
    const res = await app.request("/api/accounts/999");
    expect(res.status).toBe(404);
  });

  it("PUT /:id updates a record", async () => {
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset" }),
    });

    const res = await app.request("/api/accounts/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash on Hand", type: "asset" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Cash on Hand");
  });

  it("DELETE /:id removes a record", async () => {
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset" }),
    });

    const res = await app.request("/api/accounts/1", { method: "DELETE" });
    expect(res.status).toBe(200);

    const check = await app.request("/api/accounts/1");
    expect(check.status).toBe(404);
  });

  it("DELETE /:id returns 404 for missing record", async () => {
    const res = await app.request("/api/accounts/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /export.csv streams all rows with headers", async () => {
    for (let i = 0; i < 3; i++) {
      await app.request("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Account ${i}`, type: "asset", balance: i * 100 }),
      });
    }

    const res = await app.request("/api/accounts/export.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="accounts.csv"`,
    );

    const body = await res.text();
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(4); // 1 header + 3 rows
    expect(lines[0]).toBe("id,name,type,balance");
    expect(lines[1]).toBe("1,Account 0,asset,0");
    expect(lines[3]).toBe("3,Account 2,asset,200");
  });

  it("GET /export.csv respects filter and sort params", async () => {
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "asset", balance: 500 }),
    });
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bank", type: "asset", balance: 1000 }),
    });
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Loan", type: "liability", balance: 2000 }),
    });

    const res = await app.request(
      "/api/accounts/export.csv?filter[type][eq]=asset&sort=-balance",
    );
    expect(res.status).toBe(200);
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 assets
    expect(lines[1]).toContain("Bank"); // balance 1000 — descending
    expect(lines[2]).toContain("Cash"); // balance 500
  });

  it("GET /export.csv ignores pagination params", async () => {
    for (let i = 0; i < 60; i++) {
      await app.request("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `A${i}`, type: "asset" }),
      });
    }

    const res = await app.request("/api/accounts/export.csv?page=2&limit=10");
    expect(res.status).toBe(200);
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toHaveLength(61); // header + all 60 rows
  });

  it("GET /export.csv escapes commas and quotes in values", async () => {
    await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Smith, "Alice"`, type: "asset" }),
    });

    const res = await app.request("/api/accounts/export.csv");
    const body = await res.text();
    expect(body).toContain(`"Smith, ""Alice"""`);
  });
});

describe("CRUD immutable table", () => {
  let app: Hono;

  beforeEach(async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL
      )
    `);

    const ledgerTable = sqliteTable("ledger", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      description: text("description").notNull(),
    });

    const ledger = table({
      drizzle: ledgerTable,
      meta: { immutable: true },
    });

    app = new Hono();
    app.route("/api/ledger", crud(ledger, db));
  });

  it("blocks PUT on immutable table", async () => {
    const res = await app.request("/api/ledger/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "updated" }),
    });
    expect(res.status).toBe(403);
  });

  it("blocks DELETE on immutable table", async () => {
    const res = await app.request("/api/ledger/1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });
});
