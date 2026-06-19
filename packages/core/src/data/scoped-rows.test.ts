import { describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { ValidationError } from "../db/errors.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import {
  ImmutableTableOperationError,
  RowNotFoundError,
  scopedRows,
} from "./scoped-rows.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  balance: integer("balance"),
});

const accounts = table({
  drizzle: accountsTable,
  meta: {
    rowScope: "systemGlobal",
    rowLabelColumns: ["name"],
    selects: [
      {
        type: "select",
        column: "type",
        options: ["asset", "liability", "equity", "revenue", "expense"],
      },
    ],
  },
});

describe("scopedRows", () => {
  function setupAccounts() {
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance INTEGER
      )
    `);
    return {
      db,
      rows: scopedRows(
        db,
        createTestAuthContext({ tables: [accounts] }),
        accounts,
      ),
    };
  }

  it("creates one record", async () => {
    const { rows } = setupAccounts();
    const created = await rows.create({ name: "Cash", type: "asset" });

    expect(created).toMatchObject({
      id: 1,
      name: "Cash",
      type: "asset",
    });
  });

  it("validates create input", async () => {
    const { rows } = setupAccounts();
    await expect(
      rows.create({ name: "Bad", type: "invalid" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists with pagination metadata", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });
    await rows.create({ name: "Revenue", type: "revenue" });

    const result = await rows.list();
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
    expect(result.meta.page).toBe(1);
  });

  it("gets one record by primary key", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });

    await expect(rows.get("1")).resolves.toMatchObject({ name: "Cash" });
    await expect(rows.get("999")).rejects.toBeInstanceOf(RowNotFoundError);
  });

  it("updates and deletes records by primary key", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });

    await expect(
      rows.update("1", { name: "Cash on Hand", type: "asset" }),
    ).resolves.toMatchObject({ name: "Cash on Hand" });
    await expect(rows.delete("1")).resolves.toMatchObject({
      name: "Cash on Hand",
    });
    await expect(rows.get("1")).rejects.toBeInstanceOf(RowNotFoundError);
  });

  it("blocks update and delete on immutable tables", async () => {
    const ledgerTable = sqliteTable("ledger", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      description: text("description").notNull(),
    });
    const ledger = table({
      drizzle: ledgerTable,
      meta: {
        immutable: true,
        rowScope: "systemGlobal",
        rowLabelColumns: ["description"],
      },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL
      );
      INSERT INTO ledger (description) VALUES ('created');
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [ledger] }),
      ledger,
    );

    await expect(
      rows.update("1", { description: "updated" }),
    ).rejects.toBeInstanceOf(ImmutableTableOperationError);
    await expect(rows.delete("1")).rejects.toBeInstanceOf(
      ImmutableTableOperationError,
    );
  });

  it("applies row scope to list/get/update/delete", async () => {
    const documentsTable = sqliteTable("documents", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspace_id: text("workspace_id").notNull(),
      title: text("title").notNull(),
    });
    const documents = table({
      drizzle: documentsTable,
      meta: { rowScope: "workspaceGlobal", rowLabelColumns: ["title"] },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL
      );
      INSERT INTO documents (workspace_id, title) VALUES
        ('workspace-1', 'Visible'),
        ('workspace-2', 'Hidden');
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [documents] }),
      documents,
    );

    const result = await rows.list();
    expect(result.data.map((row) => row.title)).toEqual(["Visible"]);
    expect(result.meta.total).toBe(1);
    await expect(rows.get("2")).rejects.toBeInstanceOf(RowNotFoundError);
    await expect(
      rows.update("2", { title: "Still hidden" }),
    ).rejects.toBeInstanceOf(RowNotFoundError);
    await expect(rows.delete("2")).rejects.toBeInstanceOf(RowNotFoundError);
  });

  it("looks up row labels inside row scope", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });
    await rows.create({ name: "Revenue", type: "revenue" });
    await rows.create({ name: "Rent", type: "expense" });

    await expect(rows.lookup({ ids: "1,2" })).resolves.toEqual({
      "1": "Cash",
      "2": "Revenue",
    });
    await expect(rows.lookup({ q: "re" })).resolves.toEqual({
      "2": "Revenue",
      "3": "Rent",
    });
    await expect(rows.lookup({ q: "re", limit: "1" })).resolves.toEqual({
      "2": "Revenue",
    });
    await expect(rows.lookup({ limit: "2" })).resolves.toEqual({
      "1": "Cash",
      "2": "Revenue",
    });
  });

  it("counts grouped rows inside row scope", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });
    await rows.create({ name: "Bank", type: "asset" });
    await rows.create({ name: "Revenue", type: "revenue" });

    await expect(
      rows.count({ group_by: "type", ids: "asset,revenue" }),
    ).resolves.toEqual({ asset: 2, revenue: 1 });
  });
});
