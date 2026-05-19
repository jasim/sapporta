/**
 * Layer 3 — storage-alignment fixtures (DATA-TYPE-PRINCIPLES.md Part V §3).
 *
 * One fixture per kind, exercising the actual SQLite driver. These fail
 * loudly if a column ever regresses to the wrong storage type — the test
 * is a floor under the "pick storage whose native operators do the right
 * thing" principle, not an exercise of the query builder.
 *
 * Each block inserts a small set whose naive ordering would disagree with
 * the intended semantics if storage were picked wrong (e.g. numbers stored
 * as TEXT sort `[100000, 25000, 3000, 9500]` lexicographically).
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import {
  bool,
  date,
  money,
  number,
  text,
  timestamp,
} from "../schema/columns.js";
import { crud } from "./crud.js";
import { createTestDb } from "../testing/test-utils.js";

// ── Numbers: REAL storage, numeric compare/sort ─────────────────────────

describe("storage alignment — numbers", () => {
  const accounts = sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    balance: money("balance").notNull(),
  });
  const accounts_def = table({ drizzle: accounts });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, balance REAL NOT NULL)`,
    );
    const app = new Hono();
    app.route("/accounts", crud(accounts_def, db));
    for (const balance of [3000, 100000, 9500, 25000]) {
      const res = await app.request("/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance }),
      });
      expect(res.status).toBe(201);
    }
    return { app, sqlite };
  }

  it("ORDER BY ASC returns numeric (not lexicographic) order", async () => {
    const { sqlite } = await setup();
    const rows = sqlite
      .prepare("SELECT balance FROM accounts ORDER BY balance ASC")
      .all() as Array<{ balance: number }>;
    expect(rows.map((r) => r.balance)).toEqual([3000, 9500, 25000, 100000]);
  });

  it("gt filter matches numerically, not lexicographically", async () => {
    const { app } = await setup();
    const res = await app.request("/accounts?filter[balance][gt]=10000&sort=balance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ balance: number }> };
    expect(body.data.map((r) => r.balance)).toEqual([25000, 100000]);
  });
});

// ── Dates: TEXT ISO, lex = calendar order ───────────────────────────────

describe("storage alignment — dates", () => {
  const events = sqliteTable("events", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurred_on: date("occurred_on").notNull(),
  });
  const events_def = table({ drizzle: events });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_on TEXT NOT NULL)`,
    );
    const app = new Hono();
    app.route("/events", crud(events_def, db));
    for (const d of ["2024-10-01", "2024-01-15", "2024-02-03"]) {
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurred_on: d }),
      });
      expect(res.status).toBe(201);
    }
    return { app, sqlite };
  }

  it("ISO dates sort lex-equal to calendar order", async () => {
    const { sqlite } = await setup();
    const rows = sqlite
      .prepare("SELECT occurred_on FROM events ORDER BY occurred_on ASC")
      .all() as Array<{ occurred_on: string }>;
    expect(rows.map((r) => r.occurred_on)).toEqual([
      "2024-01-15",
      "2024-02-03",
      "2024-10-01",
    ]);
  });

  it("rejects US-format date inputs at the boundary", async () => {
    const { app } = await setup();
    const res = await app.request("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurred_on: "1/15/2024" }),
    });
    // Validation rejects with 422 (Unprocessable Entity) before storage.
    expect(res.status).toBe(422);
  });

  it("gt filter matches calendrically", async () => {
    const { app } = await setup();
    const res = await app.request(
      "/events?filter[occurred_on][gt]=2024-02-01&sort=occurred_on",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ occurred_on: string }>;
    };
    expect(body.data.map((r) => r.occurred_on)).toEqual([
      "2024-02-03",
      "2024-10-01",
    ]);
  });
});

// ── Timestamps: fixed-width UTC TEXT, lex = chronological ───────────────

describe("storage alignment — timestamps", () => {
  const audits = sqliteTable("audits", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: timestamp("at").notNull(),
  });
  const audits_def = table({ drizzle: audits });

  it("canonicalized timestamps sort chronologically", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)`,
    );
    const app = new Hono();
    app.route("/audits", crud(audits_def, db));
    // Mixed input encodings of three distinct instants. Canonicalization
    // folds them into fixed-width UTC, and lex order then matches chronology.
    const inputs = [
      "2024-01-15T14:00:00+02:00", // = 12:00:00Z
      "2024-01-15T10:00:00.500Z", // truncates to 10:00:00Z
      "2024-01-15T08:00:00Z",
    ];
    for (const at of inputs) {
      const res = await app.request("/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at }),
      });
      expect(res.status).toBe(201);
    }
    const rows = sqlite
      .prepare("SELECT at FROM audits ORDER BY at ASC")
      .all() as Array<{ at: string }>;
    expect(rows.map((r) => r.at)).toEqual([
      "2024-01-15T08:00:00Z",
      "2024-01-15T10:00:00Z",
      "2024-01-15T12:00:00Z",
    ]);
  });
});

// ── Booleans: INTEGER 0/1 round-trip ───────────────────────────────────

describe("storage alignment — booleans", () => {
  const toggles = sqliteTable("toggles", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    is_active: bool("is_active").notNull(),
  });
  const toggles_def = table({ drizzle: toggles });

  it("true/false round-trip through INTEGER 0/1", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE toggles (id INTEGER PRIMARY KEY AUTOINCREMENT, is_active INTEGER NOT NULL)`,
    );
    const app = new Hono();
    app.route("/toggles", crud(toggles_def, db));

    for (const is_active of [true, false, true]) {
      const res = await app.request("/toggles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      });
      expect(res.status).toBe(201);
    }

    // Storage is 0/1, not 'true'/'false' strings.
    const rawRows = sqlite
      .prepare("SELECT is_active FROM toggles ORDER BY id")
      .all() as Array<{ is_active: number }>;
    expect(rawRows.map((r) => r.is_active)).toEqual([1, 0, 1]);

    // The API roundtrips as booleans.
    const res = await app.request("/toggles?filter[is_active][eq]=true");
    const body = (await res.json()) as {
      data: Array<{ is_active: boolean }>;
    };
    expect(body.data).toHaveLength(2);
    for (const row of body.data) expect(row.is_active).toBe(true);
  });
});

// ── Null vs empty string: distinct in TEXT columns ──────────────────────

describe("storage alignment — null vs empty string", () => {
  const notes = sqliteTable("notes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    body: text("body"),
  });
  const notes_def = table({ drizzle: notes });

  it("'' and null are distinct; no silent coercion between them", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)`,
    );
    const app = new Hono();
    app.route("/notes", crud(notes_def, db));

    for (const body of [{ body: "" }, { body: null }, { body: "hello" }]) {
      const res = await app.request("/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
    }

    const byIsNull = sqlite
      .prepare("SELECT COUNT(*) AS n FROM notes WHERE body IS NULL")
      .get() as { n: number };
    expect(byIsNull.n).toBe(1);

    const byEmpty = sqlite
      .prepare("SELECT COUNT(*) AS n FROM notes WHERE body = ''")
      .get() as { n: number };
    expect(byEmpty.n).toBe(1);
  });
});

// ── End-to-end URL round-trip (Layer 4) ─────────────────────────────────

describe("URL round-trip — encoded filters execute and match", () => {
  const accounts = sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    balance: money("balance").notNull(),
    opened_on: date("opened_on").notNull(),
  });
  const accounts_def = table({ drizzle: accounts });

  it("UI-encoded filters flow through decodeFilters + parseFilters into rows", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        balance REAL NOT NULL,
        opened_on TEXT NOT NULL
      )
    `);
    const app = new Hono();
    app.route("/accounts", crud(accounts_def, db));

    const seed = [
      { balance: 500, opened_on: "2024-01-15" },
      { balance: 15000, opened_on: "2024-06-01" },
      { balance: 120000, opened_on: "2023-12-20" },
    ];
    for (const body of seed) {
      const res = await app.request("/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
    }

    // Simulate the UI building a URL via encodeFilters-shaped params.
    const qs = new URLSearchParams();
    qs.append("filter[balance][gte]", "1000");
    qs.append("filter[opened_on][lt]", "2024-07-01");
    qs.append("sort", "balance");

    const res = await app.request(`/accounts?${qs.toString()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ balance: number; opened_on: string }>;
    };
    expect(body.data.map((r) => r.balance)).toEqual([15000, 120000]);
  });
});

