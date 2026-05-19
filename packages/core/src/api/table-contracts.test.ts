/**
 * Schema boundary tests for the table contracts.
 *
 * Deliberately minimal: one happy + one sad path for the three schemas
 * that still carry real structure (the rest of the contracts are
 * passthrough `looseObject`/`looseRowArray` and not worth unit-testing).
 *
 *   - listMetaSchema           pagination envelope
 *   - tableRowSchemaFor        per-table row shape (typed columns, enum selects)
 *   - tableCreateBodySchemaFor create-body union (single / array / master-with-$details)
 */
import { describe, it, expect } from "vitest";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { listRoute, createRoute } from "./table-contracts.js";
import {
  tableRowSchemaFor,
  tableCreateBodySchemaFor,
} from "./table-schemas.js";

const accounts = table({
  drizzle: sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    balance: integer("balance"),
  }),
  meta: {
    selects: [
      { type: "select", column: "type", options: ["asset", "liability"] },
    ],
  },
});

const txns = table({
  drizzle: sqliteTable("txns", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account_id: integer("account_id").notNull(),
    amount: integer("amount").notNull(),
  }),
});

const accountsWithChildren = table({
  drizzle: accounts.drizzle,
  meta: {
    ...accounts.meta,
    children: [{ table: "txns", foreignKey: "account_id" }],
  },
});

describe("listRoute — list response pagination envelope", () => {
  const envelope = listRoute(accounts).responses[200];

  it("parses a valid envelope", () => {
    const r = envelope.safeParse({
      data: [{ id: 1, name: "Cash", type: "asset", balance: 100 }],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a string-typed `total` (no coercion on responses)", () => {
    const r = envelope.safeParse({
      data: [],
      meta: { total: "1", limit: 20, offset: 0 },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["meta", "total"]);
  });

  it("rejects a missing `limit`", () => {
    const r = envelope.safeParse({ data: [], meta: { total: 0, offset: 0 } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["meta", "limit"]);
  });
});

describe("tableRowSchemaFor", () => {
  const row = tableRowSchemaFor(accounts);

  it("parses a valid row", () => {
    expect(
      row.safeParse({ id: 1, name: "Cash", type: "asset", balance: 100 })
        .success,
    ).toBe(true);
  });

  it("allows a nullable column to be null", () => {
    expect(
      row.safeParse({ id: 1, name: "Cash", type: "asset", balance: null })
        .success,
    ).toBe(true);
  });

  it("rejects a wrong type on a NOT NULL column", () => {
    const r = row.safeParse({ id: 1, name: 123, type: "asset", balance: 100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["name"]);
  });

  it("rejects a value outside the declared select enum", () => {
    const r = row.safeParse({
      id: 1,
      name: "Cash",
      type: "bogus",
      balance: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["type"]);
  });
});

describe("tableCreateBodySchemaFor", () => {
  const body = tableCreateBodySchemaFor(accountsWithChildren, [
    accountsWithChildren,
    txns,
  ]);

  it("parses a single-row object (id omitted — auto-generated)", () => {
    expect(body.safeParse({ name: "Cash", type: "asset" }).success).toBe(true);
  });

  it("parses an array of rows", () => {
    expect(
      body.safeParse([
        { name: "Cash", type: "asset" },
        { name: "AP", type: "liability" },
      ]).success,
    ).toBe(true);
  });

  it("parses a master-with-$details payload (child FK omitted)", () => {
    const r = body.safeParse({
      name: "Cash",
      type: "asset",
      $details: {
        table: "txns",
        fk: "account_id",
        rows: [{ amount: 100 }, { amount: 200 }],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a $details row that carries the omitted FK (strict insert)", () => {
    const r = body.safeParse({
      name: "Cash",
      type: "asset",
      $details: {
        table: "txns",
        fk: "account_id",
        rows: [{ amount: 100, account_id: 99 }],
      },
    });
    expect(r.success).toBe(false);
  });
});
