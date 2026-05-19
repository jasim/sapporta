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
import { Hono } from "hono";
import { sqliteTable, integer, text as drizzleText } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { timestamp, date } from "../schema/columns.js";
import { crud } from "./crud.js";
import { parseQuery } from "./query-parser.js";
import { createTestDb } from "../testing/test-utils.js";
import { parsePlainDate, parseCanonicalInstant } from "@sapporta/shared/temporal";
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
    const events_def = table({ drizzle: events });

    // Impossible date routed through the server's filter parse → 400.
    expect(() =>
      parseQuery(
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
    const row = sqlite.prepare(`SELECT SUM(v) AS s FROM t`).get() as { s: number };
    expect(Math.abs(row.s - 100)).toBeLessThan(1e-6);
  });
});

// §4 — LIKE escaping: user-supplied % and _ match literally
describe("LIKE escaping — user wildcards match literally", () => {
  const promos = sqliteTable("promos", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: drizzleText("name").notNull(),
  });
  const promos_def = table({ drizzle: promos });

  async function setup() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(
      `CREATE TABLE promos (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`,
    );
    const app = new Hono();
    app.route("/promos", crud(promos_def, db));
    const insert = async (name: string) => {
      const res = await app.request("/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(201);
    };
    await insert("50% off");
    await insert("50X off");
    await insert("a_b");
    await insert("aXb");
    return app;
  }

  async function fetchNames(app: Hono, query: string): Promise<string[]> {
    const res = await app.request(`/promos?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    return body.data.map((r) => r.name);
  }

  it("contains `50%` matches only the literal '%' row", async () => {
    const app = await setup();
    const names = await fetchNames(
      app,
      "filter[name][contains]=" + encodeURIComponent("50%"),
    );
    expect(names).toEqual(["50% off"]);
  });

  it("contains `a_b` matches only the literal '_' row", async () => {
    const app = await setup();
    const names = await fetchNames(
      app,
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
    const events_def = table({ drizzle: events });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )
    `);

    const app = new Hono();
    app.route("/events", crud(events_def, db));

    const forms = [
      { description: "whole-second-Z", occurred_at: "2024-01-15T12:00:00Z" },
      { description: "fractional", occurred_at: "2024-01-15T12:00:00.500Z" },
      { description: "offset", occurred_at: "2024-01-15T14:00:00+02:00" },
    ];

    for (const body of forms) {
      const res = await app.request("/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
    }

    const rows = sqlite
      .prepare(`SELECT description, occurred_at FROM events`)
      .all() as Array<{ description: string; occurred_at: string }>;

    for (const row of rows) {
      expect(row.occurred_at).toBe("2024-01-15T12:00:00Z");
    }
  });
});

