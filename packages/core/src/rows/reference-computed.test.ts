import { describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import type { RecordId } from "@sapporta/shared/record-id";
import { createTableCatalog } from "../schema/catalog.js";
import { computedField, sapportaTable } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { attachReferenceComputed } from "./reference-computed.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});
const itemsTable = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
});

function setup() {
  const loads: Array<{ table: string; field: string; ids: RecordId[] }> = [];
  const accounts = sapportaTable({
    drizzle: accountsTable,
    meta: { rowLabelColumns: ["name"], rowCaption: "parentPath" },
    computed: {
      parentPath: computedField({
        kind: "text",
        load: ({ ids }) => {
          loads.push({ table: "accounts", field: "parentPath", ids: [...ids] });
          return new Map(ids.map((id) => [id, `path of ${id}`]));
        },
      }),
      balance: computedField({
        kind: "number",
        load: ({ ids }) => {
          loads.push({ table: "accounts", field: "balance", ids: [...ids] });
          return new Map(ids.map((id) => [id, Number(id) * 10]));
        },
      }),
    },
  });
  // A caption that is a column: nothing to compute.
  const items = sapportaTable({
    drizzle: itemsTable,
    meta: { rowLabelColumns: ["name"], rowCaption: "sku" },
  });
  const { db } = createTestDb();
  const auth = createTestAuthContext({ tables: [accounts, items] });
  return { accounts, items, db, auth, loads };
}

function ledger(): GridDataset {
  return {
    name: "ledger",
    label: "Ledger",
    rootLevel: "groups",
    levels: {
      groups: {
        columns: [
          { id: "group_id", label: "ID", kind: "number", visuallyHidden: true },
          {
            id: "group",
            label: "Group",
            kind: "text",
            reference: { table: "accounts", idColumn: "group_id" },
          },
        ],
        childLevels: ["lines"],
      },
      lines: {
        columns: [
          {
            id: "account_id",
            label: "ID",
            kind: "number",
            visuallyHidden: true,
          },
          {
            id: "account",
            label: "Account",
            kind: "text",
            reference: { table: "accounts", idColumn: "account_id" },
          },
          { id: "item_id", label: "ID", kind: "number", visuallyHidden: true },
          {
            id: "item",
            label: "Item",
            kind: "text",
            reference: { table: "items", idColumn: "item_id" },
          },
        ],
        childLevels: [],
      },
    },
    nodes: [1, 2].map((group) => ({
      rowKey: `g${group}`,
      levelName: "groups",
      columns: { group_id: group, group: `Group ${group}` },
      children: {
        lines: [
          {
            rowKey: `l${group}`,
            levelName: "lines",
            columns: { account_id: group + 10, account: "A", item_id: 7 },
          },
        ],
      },
    })),
    footerRows: [{ rowKey: "total", columns: { group_id: 99 } }],
  };
}

describe("attachReferenceComputed", () => {
  it("runs each loader once per table across nested nodes", async () => {
    const { accounts, items, db, auth, loads } = setup();

    const result = await attachReferenceComputed(ledger(), {
      db,
      auth,
      tables: [accounts, items],
      names: { accounts: ["balance"] },
    });

    const ids = ["1", "11", "2", "12", "99"];
    expect(loads).toEqual([
      { table: "accounts", field: "balance", ids },
      { table: "accounts", field: "parentPath", ids },
    ]);
    expect(Object.keys(result.computed ?? {})).toEqual(["accounts"]);
    expect(result.computed?.accounts?.parentPath).toEqual(
      Object.fromEntries(ids.map((id) => [id, `path of ${id}`])),
    );
    expect(result.computed?.accounts?.balance?.["12"]).toBe(120);
    // The rows themselves are unchanged.
    expect(result.nodes).toEqual(ledger().nodes);
  });

  it("accepts the table catalog, and returns a dataset without references as is", async () => {
    const { accounts, items, db, auth, loads } = setup();
    const catalog = createTableCatalog([accounts, items]);
    const plain: GridDataset = {
      ...ledger(),
      levels: {
        groups: { columns: [], childLevels: [] },
      },
      rootLevel: "groups",
    };

    expect(
      await attachReferenceComputed(plain, { db, auth, tables: catalog }),
    ).toBe(plain);
    const result = await attachReferenceComputed(ledger(), {
      db,
      auth,
      tables: catalog,
    });
    expect(loads.map((load) => load.field)).toEqual(["parentPath"]);
    expect(Object.keys(result.computed?.accounts ?? {})).toEqual([
      "parentPath",
    ]);
  });

  it("names an unknown referenced table", async () => {
    const { accounts, db, auth } = setup();
    await expect(
      attachReferenceComputed(ledger(), { db, auth, tables: [accounts] }),
    ).rejects.toThrow(
      'Dataset "ledger" references table "items", which is not one of the app\'s tables.',
    );
  });
});
