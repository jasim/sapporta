import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { lookupEndpoint } from "./lookup.js";
import { findRowLabelColumns } from "./row-label.js";
import { createTestDb } from "../testing/test-utils.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
});

const accounts = table({
  drizzle: accountsTable,
  meta: { label: "Accounts" },
});

describe("findRowLabelColumns", () => {
  it("returns first text non-PK column", () => {
    expect(findRowLabelColumns(accounts)).toEqual(["name"]);
  });

  it("skips FK columns", () => {
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      account_id: integer("account_id")
        .notNull()
        .references(() => accountsTable.id),
      description: text("description").notNull(),
    });
    const invoices = table({ drizzle: invoicesTable, meta: {} });
    expect(findRowLabelColumns(invoices)).toEqual(["description"]);
  });

  it("returns null when no text column exists", () => {
    const numbersTable = sqliteTable("numbers", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      value: integer("value").notNull(),
    });
    const numbers = table({ drizzle: numbersTable, meta: {} });
    expect(findRowLabelColumns(numbers)).toBeNull();
  });

  it("honors meta.rowLabelColumns override", () => {
    const ordersTable = sqliteTable("orders", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      first_name: text("first_name").notNull(),
      last_name: text("last_name").notNull(),
    });
    const orders = table({
      drizzle: ordersTable,
      meta: { rowLabelColumns: ["first_name", "last_name"] },
    });
    expect(findRowLabelColumns(orders)).toEqual(["first_name", "last_name"]);
  });
});

describe("multi-column display", () => {
  it("concatenates display columns with a space", async () => {
    const peopleTable = sqliteTable("people", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      first_name: text("first_name").notNull(),
      last_name: text("last_name").notNull(),
    });
    const people = table({
      drizzle: peopleTable,
      meta: { rowLabelColumns: ["first_name", "last_name"] },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL
      );
      INSERT INTO people (first_name, last_name) VALUES ('Ada', 'Lovelace');
      INSERT INTO people (first_name, last_name) VALUES ('Alan', 'Turing');
    `);

    const app = new Hono();
    app.route("/api/people/_lookup", lookupEndpoint(people, db));

    const res = await app.request("/api/people/_lookup?ids=1,2");
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Ada Lovelace", "2": "Alan Turing" });
  });

  it("searches against the concatenated display label", async () => {
    const peopleTable = sqliteTable("people_search", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      first_name: text("first_name").notNull(),
      last_name: text("last_name").notNull(),
    });
    const people = table({
      drizzle: peopleTable,
      meta: { rowLabelColumns: ["first_name", "last_name"] },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS people_search (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL
      );
      INSERT INTO people_search (first_name, last_name) VALUES ('Ada', 'Lovelace');
      INSERT INTO people_search (first_name, last_name) VALUES ('Alan', 'Turing');
    `);

    const app = new Hono();
    app.route("/api/people_search/_lookup", lookupEndpoint(people, db));

    const res = await app.request("/api/people_search/_lookup?q=love");
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Ada Lovelace" });
  });
});

describe("GET /_lookup", () => {
  let app: Hono;

  beforeEach(async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL
      )
    `);
    // Insert test data
    sqlite.exec(`
      INSERT INTO accounts (name, type) VALUES ('Cash', 'asset');
      INSERT INTO accounts (name, type) VALUES ('Revenue', 'revenue');
      INSERT INTO accounts (name, type) VALUES ('Rent', 'expense');
    `);

    app = new Hono();
    app.route("/api/accounts/_lookup", lookupEndpoint(accounts, db));
  });

  it("returns display values for given IDs", async () => {
    const res = await app.request("/api/accounts/_lookup?ids=1,2");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Cash", "2": "Revenue" });
  });

  it("returns all display values when ids param is absent", async () => {
    const res = await app.request("/api/accounts/_lookup");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Cash", "2": "Revenue", "3": "Rent" });
  });

  it("returns empty object for empty ids", async () => {
    const res = await app.request("/api/accounts/_lookup?ids=");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({});
  });

  it("skips IDs that do not exist", async () => {
    const res = await app.request("/api/accounts/_lookup?ids=1,999");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Cash" });
  });

  it("filters display values by case-insensitive search text", async () => {
    const res = await app.request("/api/accounts/_lookup?q=re");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ "2": "Revenue", "3": "Rent" });
  });

  it("gives ids precedence over search text", async () => {
    const res = await app.request("/api/accounts/_lookup?ids=1&q=re");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ "1": "Cash" });
  });
});
