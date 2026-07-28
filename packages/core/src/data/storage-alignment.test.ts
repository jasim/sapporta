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
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import type { TableDef } from "../schema/table.js";
import {
  bool,
  date,
  money,
  number,
  text,
  timestamp,
} from "../schema/columns.js";
import { scopedRows } from "./scoped-rows.js";
import { ValidationError } from "../db/errors.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";

// ── Numbers: REAL storage, numeric compare/sort ─────────────────────────

describe("storage alignment — numbers", () => {
  const accounts = sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    balance: money("balance").notNull(),
  });
  const accounts_def = sapportaTable({
    drizzle: accounts,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["id"] },
  });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, balance REAL NOT NULL)`,
    );
    const rows = rowsFor(db, accounts_def);
    for (const balance of [3000, 100000, 9500, 25000]) {
      await rows.create({ balance });
    }
    return { rows, sqlite };
  }

  it("ORDER BY ASC returns numeric (not lexicographic) order", async () => {
    const { sqlite } = await setup();
    const rows = sqlite
      .prepare("SELECT balance FROM accounts ORDER BY balance ASC")
      .all() as Array<{ balance: number }>;
    expect(rows.map((r) => r.balance)).toEqual([3000, 9500, 25000, 100000]);
  });

  it("gt filter matches numerically, not lexicographically", async () => {
    const { rows } = await setup();
    const body = await rows.list({
      "filter[balance][gt]": "10000",
      sort: "balance",
    });
    expect(body.data.map((row) => row.balance)).toEqual([25000, 100000]);
  });
});

// ── Dates: TEXT ISO, lex = calendar order ───────────────────────────────

describe("storage alignment — dates", () => {
  const events = sqliteTable("events", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurred_on: date("occurred_on").notNull(),
  });
  const events_def = sapportaTable({
    drizzle: events,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["occurred_on"] },
  });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_on TEXT NOT NULL)`,
    );
    const rows = rowsFor(db, events_def);
    for (const d of ["2024-10-01", "2024-01-15", "2024-02-03"]) {
      await rows.create({ occurred_on: d });
    }
    return { rows, sqlite };
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
    const { rows } = await setup();
    await expect(
      rows.create({ occurred_on: "1/15/2024" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("gt filter matches calendrically", async () => {
    const { rows } = await setup();
    const body = await rows.list({
      "filter[occurred_on][gt]": "2024-02-01",
      sort: "occurred_on",
    });
    expect(body.data.map((row) => String(row.occurred_on))).toEqual([
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
  const audits_def = sapportaTable({
    drizzle: audits,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["at"] },
  });

  it("canonicalized timestamps sort chronologically", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE audits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)`,
    );
    const auditRows = rowsFor(db, audits_def);
    // Mixed input encodings of three distinct instants. Canonicalization
    // folds them into fixed-width UTC, and lex order then matches chronology.
    const inputs = [
      "2024-01-15T14:00:00+02:00", // = 12:00:00Z
      "2024-01-15T10:00:00.500Z", // truncates to 10:00:00Z
      "2024-01-15T08:00:00Z",
    ];
    for (const at of inputs) {
      await auditRows.create({ at });
    }
    const storedRows = sqlite
      .prepare("SELECT at FROM audits ORDER BY at ASC")
      .all() as Array<{ at: string }>;
    expect(storedRows.map((row) => row.at)).toEqual([
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
  const toggles_def = sapportaTable({
    drizzle: toggles,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["id"] },
  });

  it("true/false round-trip through INTEGER 0/1", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE toggles (id INTEGER PRIMARY KEY AUTOINCREMENT, is_active INTEGER NOT NULL)`,
    );
    const rows = rowsFor(db, toggles_def);

    for (const is_active of [true, false, true]) {
      await rows.create({ is_active });
    }

    // Storage is 0/1, not 'true'/'false' strings.
    const rawRows = sqlite
      .prepare("SELECT is_active FROM toggles ORDER BY id")
      .all() as Array<{ is_active: number }>;
    expect(rawRows.map((r) => r.is_active)).toEqual([1, 0, 1]);

    // The API roundtrips as booleans.
    const body = await rows.list({ "filter[is_active][eq]": "true" });
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
  const notes_def = sapportaTable({
    drizzle: notes,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["body"] },
  });

  it("'' and null are distinct; no silent coercion between them", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)`,
    );
    const rows = rowsFor(db, notes_def);

    for (const body of [{ body: "" }, { body: null }, { body: "hello" }]) {
      await rows.create(body);
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
  const accounts_def = sapportaTable({
    drizzle: accounts,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["id"] },
  });

  it("UI-encoded filters flow through decodeFilters + parseFilters into rows", async () => {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        balance REAL NOT NULL,
        opened_on TEXT NOT NULL
      )
    `);
    const rows = rowsFor(db, accounts_def);

    const seed = [
      { balance: 500, opened_on: "2024-01-15" },
      { balance: 15000, opened_on: "2024-06-01" },
      { balance: 120000, opened_on: "2023-12-20" },
    ];
    for (const body of seed) {
      await rows.create(body);
    }

    // Simulate the UI building a URL via encodeFilters-shaped params.
    const qs = new URLSearchParams();
    qs.append("filter[balance][gte]", "1000");
    qs.append("filter[opened_on][lt]", "2024-07-01");
    qs.append("sort", "balance");

    const body = await rows.list(Object.fromEntries(qs));
    expect(body.data.map((row) => row.balance)).toEqual([15000, 120000]);
  });
});

function rowsFor(
  db: ReturnType<typeof createTestDb>["db"],
  tableDef: TableDef,
) {
  return scopedRows(
    db,
    createTestAuthContext({ tables: [tableDef] }),
    tableDef,
  );
}
