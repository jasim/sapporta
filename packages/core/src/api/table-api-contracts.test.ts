/**
 * Schema boundary tests for the table contracts.
 *
 * Deliberately minimal: one happy + one sad path for the three schemas
 * that still carry real structure (the rest of the contracts are
 * passthrough `looseObject`/`looseRowArray` and not worth unit-testing).
 *
 *   - listMetaSchema           pagination envelope
 *   - tableApiZod.forRow       per-table row shape (typed columns, enum selects)
 *   - createRoute body         create-body union (single / array / master-with-$details)
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import { createRoute, listRoute, updateRoute } from "./table-api-contracts.js";
import { tableApiZod } from "./table-api-zod.js";
import { tableWriteZod } from "../rows/table-write-zod.js";

const accounts = sapportaTable({
  drizzle: sqliteTable("accounts", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type", { enum: ["asset", "liability"] }).notNull(),
    balance: integer("balance"),
  }),
  meta: {
    rowLabelColumns: ["name"],
  },
});

const txns = sapportaTable({
  drizzle: sqliteTable("txns", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    account_id: integer("account_id").notNull(),
    amount: integer("amount").notNull(),
  }),
  meta: { rowLabelColumns: ["id"] },
});

const accountsWithChildren = sapportaTable({
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
      meta: { total: 1, page: 1, limit: 20, pages: 1 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a string-typed `total` (no coercion on responses)", () => {
    const r = envelope.safeParse({
      data: [],
      meta: { total: "1", page: 1, limit: 20, pages: 0 },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["meta", "total"]);
  });

  it("rejects a missing `limit`", () => {
    const r = envelope.safeParse({
      data: [],
      meta: { total: 0, page: 1, pages: 0 },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["meta", "limit"]);
  });
});

describe("tableApiZod.forRow", () => {
  const row = tableApiZod.forRow(accounts);

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

describe("createRoute body", () => {
  const body = createRoute(accountsWithChildren, [
    accountsWithChildren,
    txns,
  ]).body;

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

/**
 * A child FK is routinely server-owned, so `forInsert` has already dropped it
 * before `createRoute` omits it again. Zod 4 rejects an `.omit()` mask key the
 * shape does not carry, and it does so from the lazy `shape` getter — the
 * throw lands in `z.toJSONSchema`, taking down OpenAPI and every consumer of
 * it (`/api/openapi.json`, `sapporta endpoints list|show`) while row CRUD
 * keeps working. The matrix below pins each way the FK can leave the shape.
 */
describe("createRoute body — children whose FK is not API-writable", () => {
  const childFkMetas = {
    "reference apiSettable: false": {
      references: { account_id: { table: "accounts", apiSettable: false } },
    },
    "reference apiSettable: true": {
      references: { account_id: { table: "accounts", apiSettable: true } },
    },
    "reference without apiSettable": {
      references: { account_id: { table: "accounts" } },
    },
    "column apiWritable: false": {
      columns: { account_id: { apiWritable: false } },
    },
    "no metadata on the FK": {},
  } as const;

  for (const [label, extraMeta] of Object.entries(childFkMetas)) {
    describe(label, () => {
      const child = sapportaTable({
        drizzle: txns.drizzle,
        meta: { ...txns.meta, ...extraMeta },
      });
      const tables = [accountsWithChildren, child];
      const childBody = createRoute(accountsWithChildren, tables).body;

      it("renders JSON schema (OpenAPI generation)", () => {
        expect(() =>
          z.toJSONSchema(childBody as z.ZodType, {
            io: "input",
            unrepresentable: "any",
          }),
        ).not.toThrow();
      });

      it("parses a $details payload and rejects a row carrying the FK", () => {
        const payload = (rows: Record<string, unknown>[]) => ({
          name: "Cash",
          type: "asset",
          $details: { table: "txns", fk: "account_id", rows },
        });
        expect(childBody.safeParse(payload([{ amount: 100 }])).success).toBe(
          true,
        );
        expect(
          childBody.safeParse(payload([{ amount: 100, account_id: 99 }]))
            .success,
        ).toBe(false);
      });
    });
  }
});

describe("API and save-boundary write projections", () => {
  const customersTable = sqliteTable("customers", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
  });
  const customers = sapportaTable({
    drizzle: customersTable,
    meta: { rowLabelColumns: ["name"], rowScope: "systemGlobal" },
  });
  const invoices = sapportaTable({
    drizzle: sqliteTable("secured_invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
      number: text("number").notNull(),
      customer_id: integer("customer_id")
        .notNull()
        .references(() => customersTable.id),
      internal_note: text("internal_note"),
      optional_code: text("optional_code").default("pending"),
      total: integer("total").notNull(),
    }),
    meta: {
      rowLabelColumns: ["number"],
      rowScope: "workspaceGlobal",
      references: {
        customer_id: { table: "customers", apiSettable: false },
      },
      columns: { internal_note: { apiWritable: false } },
    },
  });
  const tables = [customers, invoices];

  it("excludes generated, auth-owned, server-reference, and non-API-writable fields", () => {
    const insert = tableApiZod.forInsert(invoices, tables);
    const body = createRoute(invoices, tables).body;
    expect(insert.safeParse({ number: "INV-1", total: 10 }).success).toBe(true);
    expect(
      insert.safeParse({ number: "INV-1", total: 10, optional_code: null })
        .success,
    ).toBe(true);
    expect(body.safeParse({ number: "INV-1", total: 10 }).success).toBe(true);
    for (const forbidden of [
      "id",
      "workspace_id",
      "customer_id",
      "internal_note",
    ]) {
      expect(
        body.safeParse({ number: "INV-1", total: 10, [forbidden]: 1 }).success,
      ).toBe(false);
    }
  });

  it("describes patch values as partial while preserving value types", () => {
    const apiPatch = tableApiZod.forPatch(invoices, tables);
    const routePatch = updateRoute(invoices, tables).body;
    expect(apiPatch.safeParse({ total: 20 }).success).toBe(true);
    expect(apiPatch.safeParse({}).success).toBe(true);
    expect(apiPatch.safeParse({ total: "20" }).success).toBe(false);
    expect(apiPatch.safeParse({ internal_note: "hidden" }).success).toBe(false);
    expect(routePatch.safeParse({ total: 20 }).success).toBe(true);
  });

  it("requires trusted fields in the write-boundary insert schema", () => {
    const writeInsert = tableWriteZod.forInsert(invoices);
    expect(
      writeInsert.safeParse({
        workspace_id: "ws-1",
        number: "INV-1",
        customer_id: 1,
        optional_code: null,
        total: 10,
      }).success,
    ).toBe(true);
    expect(
      writeInsert.safeParse({ number: "INV-1", customer_id: 1, total: 10 })
        .success,
    ).toBe(false);
    expect(
      writeInsert.safeParse({
        workspace_id: "ws-1",
        number: "INV-1",
        customer_id: 1,
        total: "10",
      }).success,
    ).toBe(false);
  });

  it("lets trusted patches write structural columns that the API excludes", () => {
    const apiPatch = tableApiZod.forPatch(invoices, tables);
    const writePatch = tableWriteZod.forPatch(invoices);

    expect(apiPatch.safeParse({ internal_note: "reviewed" }).success).toBe(
      false,
    );
    expect(writePatch.safeParse({ internal_note: "reviewed" }).success).toBe(
      true,
    );
    expect(writePatch.safeParse({ workspace_id: "ws-2" }).success).toBe(true);
    expect(writePatch.safeParse({ total: "20" }).success).toBe(false);
  });
});
