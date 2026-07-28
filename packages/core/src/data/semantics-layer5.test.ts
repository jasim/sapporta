/**
 * Layer 5 — explicit semantic pins.
 *
 * These four tests guard choices that would otherwise quietly regress.
 * They correspond one-for-one to docs/DATA-TYPE-PRINCIPLES.md Part V §5:
 *
 *   1. Timestamp precision normalization
 *   2. Strict calendar validity (date + timestamp)
 *   3. REAL money arithmetic tolerance
 *   4. LIKE escaping (user `%` / `_` matched literally)
 *
 * If any of these fail, the design drift is architectural — the fix
 * belongs upstream of the test, not in the test.
 */

import { describe, expect, it } from "vitest";
import {
  sqliteTable,
  integer,
  text as drizzleText,
} from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import type { TableDef } from "../schema/table.js";
import { timestamp, date } from "../schema/columns.js";
import { resolvePageQuery } from "../api/table-query.js";
import { scopedRows } from "./scoped-rows.js";
import { createTestDb } from "../testing/test-utils.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTableCatalog } from "../schema/catalog.js";
import {
  parsePlainDate,
  parseCanonicalInstant,
} from "@sapporta/shared/temporal";
import { QueryParseError } from "../db/errors.js";

// §2 — Strict calendar validity (exercised through the boundary parse)
describe("strict calendar validity", () => {
  it("rejects 2024-02-30 (impossible month day)", () => {
    expect(() => parsePlainDate("2024-02-30")).toThrow();
  });

  it("rejects 25:00:00 (impossible clock time)", () => {
    expect(() => parseCanonicalInstant("2024-01-15T25:00:00Z")).toThrow();
  });

  it("surfaces bad values as QueryParseError at the boundary", () => {
    const events = sqliteTable("events", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      occurred_on: date("occurred_on").notNull(),
    });
    const events_def = sapportaTable({
      drizzle: events,
      meta: { rowScope: "systemGlobal", rowLabelColumns: ["occurred_on"] },
    });

    // Impossible date routed through the server's filter parse → 400.
    expect(() =>
      resolveHttpListQuery(
        { "filter[occurred_on][eq]": "2024-02-30" },
        events_def,
      ),
    ).toThrow(QueryParseError);
  });
});

// §3 — REAL money arithmetic tolerance
describe("REAL money arithmetic", () => {
  it("0.1 + 0.2 is close to 0.3 within tolerance (REAL is not exact)", () => {
    const sum = 0.1 + 0.2;
    expect(Math.abs(sum - 0.3)).toBeLessThan(1e-10);
    // The point of this test isn't to prove REAL is exact — it isn't. It's
    // to make the tradeoff visible, so a future change that assumes exact
    // decimal fails loudly here and the assumption gets re-examined.
    expect(sum).not.toBe(0.3);
  });

  it("sum of 10k × 0.01 is within tolerance of 100", () => {
    let total = 0;
    for (let i = 0; i < 10000; i++) total += 0.01;
    expect(Math.abs(total - 100)).toBeLessThan(1e-10);
  });

  it("SQLite SUM over REAL stays within tolerance", () => {
    const { sqlite } = createTestDb();
    sqlite.exec(`CREATE TABLE t (v REAL NOT NULL)`);
    const insert = sqlite.prepare(`INSERT INTO t (v) VALUES (?)`);
    for (let i = 0; i < 10000; i++) insert.run(0.01);
    const row = sqlite.prepare(`SELECT SUM(v) AS s FROM t`).get() as {
      s: number;
    };
    expect(Math.abs(row.s - 100)).toBeLessThan(1e-6);
  });
});

// §4 — LIKE escaping: user-supplied % and _ match literally
describe("LIKE escaping — user wildcards match literally", () => {
  const promos = sqliteTable("promos", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: drizzleText("name").notNull(),
  });
  const promos_def = sapportaTable({
    drizzle: promos,
    meta: { rowScope: "systemGlobal", rowLabelColumns: ["name"] },
  });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE promos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`,
    );
    const rows = rowsFor(db, promos_def);
    await rows.create({ name: "50% off" });
    await rows.create({ name: "50X off" });
    await rows.create({ name: "a_b" });
    await rows.create({ name: "aXb" });
    return rows;
  }

  async function fetchNames(
    rows: ReturnType<typeof rowsFor>,
    query: string,
  ): Promise<string[]> {
    const body = await rows.page(
      resolveHttpListQuery(
        Object.fromEntries(new URLSearchParams(query)),
        promos_def,
      ),
    );
    return body.data.map((row) => String(row.name));
  }

  it("contains `50%` matches only the literal '%' row", async () => {
    const rows = await setup();
    const names = await fetchNames(
      rows,
      "filter[name][contains]=" + encodeURIComponent("50%"),
    );
    expect(names).toEqual(["50% off"]);
  });

  it("contains `a_b` matches only the literal '_' row", async () => {
    const rows = await setup();
    const names = await fetchNames(
      rows,
      "filter[name][contains]=" + encodeURIComponent("a_b"),
    );
    expect(names).toEqual(["a_b"]);
  });
});

// §1 — Timestamp precision normalization (round-trip through the factory)
describe("timestamp precision normalization", () => {
  it("stores fixed-width UTC regardless of input precision or offset", async () => {
    const events = sqliteTable("events", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      description: drizzleText("description").notNull(),
      occurred_at: timestamp("occurred_at").notNull(),
    });
    const events_def = sapportaTable({
      drizzle: events,
      meta: { rowScope: "systemGlobal", rowLabelColumns: ["description"] },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )
    `);

    const eventRows = rowsFor(db, events_def);

    const forms = [
      { description: "whole-second-Z", occurred_at: "2024-01-15T12:00:00Z" },
      { description: "fractional", occurred_at: "2024-01-15T12:00:00.500Z" },
      { description: "offset", occurred_at: "2024-01-15T14:00:00+02:00" },
    ];

    for (const body of forms) {
      await eventRows.create(body);
    }

    const storedRows = sqlite
      .prepare(`SELECT description, occurred_at FROM events`)
      .all() as Array<{ description: string; occurred_at: string }>;

    for (const row of storedRows) {
      expect(row.occurred_at).toBe("2024-01-15T12:00:00Z");
    }
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

function resolveHttpListQuery(
  query: Record<string, string>,
  tableDef: TableDef,
) {
  const catalog = createTableCatalog([tableDef]);
  return resolvePageQuery(query, tableDef, {
    auth: createTestAuthContext({ tables: [tableDef] }),
    searchPlan: catalog.searchPlanFor(tableDef.sqlName),
  });
}
