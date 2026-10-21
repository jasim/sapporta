/**
 * Narrowing a lookup's choices: `filter[col][op]=value` as on list reads,
 * and `notUnder=<id>` for the parent picker of a tree table. Lookups by id
 * are never narrowed, so a chosen row keeps its label.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { TsRestApi } from "@sapporta/honest";
import { createTableCatalog } from "../schema/catalog.js";
import { sapportaTable } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { mountTables, type TablesDocContext } from "./mount-tables.js";
import type { SapportaEnv } from "./server.js";
import { makeAuthorizedTableHandlers } from "./table-handlers.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  account_type: text("account_type").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    rowLabelColumns: ["name"],
    tree: { parentColumn: "parent_id" },
  },
});

const notesTable = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

const notes = sapportaTable({
  drizzle: notesTable,
  meta: { rowLabelColumns: ["body"] },
});

let api: TsRestApi<SapportaEnv, TablesDocContext>;
let add: (name: string, type: string, parent?: number) => number;

beforeEach(() => {
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE accounts (
      id integer PRIMARY KEY AUTOINCREMENT,
      name text NOT NULL,
      account_type text NOT NULL,
      parent_id integer REFERENCES accounts(id),
      workspace_id text NOT NULL,
      scoped_to_user_id text NOT NULL
    );
    CREATE TABLE notes (
      id integer PRIMARY KEY AUTOINCREMENT,
      body text NOT NULL,
      workspace_id text NOT NULL,
      scoped_to_user_id text NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO accounts (name, account_type, parent_id, workspace_id, scoped_to_user_id) VALUES (?, ?, ?, 'workspace-1', 'user-1')",
  );
  add = (name, type, parent) =>
    Number(insert.run(name, type, parent ?? null).lastInsertRowid);
  const catalog = createTableCatalog([accounts, notes]);
  const auth = createTestAuthContext({ tables: [accounts, notes] });
  api = new TsRestApi<SapportaEnv, TablesDocContext>();
  mountTables(
    api,
    catalog,
    makeAuthorizedTableHandlers(catalog, db, { guard: () => auth }),
  );
});

async function labels(path: string) {
  const res = await api.request(path);
  const body = (await res.json()) as {
    entries?: { label: string }[];
    code?: string;
  };
  return { status: res.status, labels: body.entries?.map((e) => e.label) };
}

describe("narrowed lookups", () => {
  it("narrows a search by the list filter grammar", async () => {
    add("Cash", "asset");
    add("Groceries", "expense");
    add("Fuel", "expense");

    expect(
      await labels("/tables/accounts/_lookup?filter[account_type][in]=expense"),
    ).toEqual({ status: 200, labels: ["Groceries", "Fuel"] });
    expect(
      await labels(
        "/tables/accounts/_lookup?q=fu&filter[account_type][in]=expense",
      ),
    ).toEqual({ status: 200, labels: ["Fuel"] });
  });

  it("leaves out a row and the rows below it", async () => {
    const expenses = add("Expenses", "expense");
    const car = add("Car", "expense", expenses);
    add("Fuel", "expense", car);
    add("Kitchen", "expense", expenses);

    expect(await labels(`/tables/accounts/_lookup?notUnder=${car}`)).toEqual({
      status: 200,
      labels: ["Expenses", "Kitchen"],
    });
  });

  it("rejects a bad filter, and notUnder on a table without a tree", async () => {
    expect(
      (await labels("/tables/accounts/_lookup?filter[nope][in]=x")).status,
    ).toBe(400);
    expect((await labels("/tables/notes/_lookup?notUnder=1")).status).toBe(
      400,
    );
  });

  it("takes no filter on a lookup by ids", async () => {
    const cash = add("Cash", "asset");

    expect(
      (
        await labels(
          `/tables/accounts/_lookup?ids=${cash}&filter[account_type][in]=expense`,
        )
      ).status,
    ).toBe(400);
    expect(await labels(`/tables/accounts/_lookup?ids=${cash}`)).toEqual({
      status: 200,
      labels: ["Cash"],
    });
  });
});
