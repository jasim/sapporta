import { describe, expect, expectTypeOf, it } from "vitest";
import { asc, desc, eq, gt, type InferSelectModel } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import { ValidationError } from "../db/errors.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import {
  ImmutableTableOperationError,
  MAX_PAGE_LIMIT,
  RowNotFoundError,
  scopedRows,
  type PageRowsResult,
} from "./scoped-rows.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["asset", "liability", "equity", "revenue", "expense"],
  }).notNull(),
  balance: integer("balance"),
});

const accounts = sapportaTable({
  drizzle: accountsTable,
  meta: {
    rowScope: "systemGlobal",
    rowLabelColumns: ["name"],
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

  it("enforces apiWritable as server write policy", async () => {
    const privateAccounts = sapportaTable({
      drizzle: accountsTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["name"],
        columns: { balance: { apiWritable: false } },
      },
    });
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        balance INTEGER
      )
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [privateAccounts] }),
      privateAccounts,
    );

    await expect(
      rows.create({ name: "Cash", type: "asset", balance: 100 }),
    ).rejects.toMatchObject({
      errors: [
        {
          field: "balance",
          message: "This field is not writable through the table API.",
        },
      ],
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

    const result = await rows.page();
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
    expect(result.meta.page).toBe(1);
  });

  it("finds bounded rows with Drizzle selection inputs", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset", balance: 100 });
    await rows.create({ name: "Revenue", type: "revenue", balance: 250 });
    await rows.create({ name: "Rent", type: "expense", balance: 300 });

    await expect(
      rows.findMany({
        where: gt(accountsTable.balance, 100),
        orderBy: desc(accountsTable.balance),
        limit: 1,
        offset: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ name: "Revenue", balance: 250 }),
    ]);
  });

  it("requires and validates findMany bounds", async () => {
    const { rows } = setupAccounts();

    await expect(rows.findMany({ limit: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
    await expect(
      rows.findMany({ limit: MAX_PAGE_LIMIT + 1 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      rows.findMany({ limit: 1, offset: -1 }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      rows.findMany({ limit: 1, offset: 0.5 }),
    ).rejects.toBeInstanceOf(RangeError);

    if (false) {
      // @ts-expect-error findMany always requires an explicit row bound.
      await rows.findMany();
    }
  });

  it("accepts Drizzle expressions for filtering, ordering, and pagination", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset", balance: 100 });
    await rows.create({ name: "Revenue", type: "revenue", balance: 250 });
    await rows.create({ name: "Rent", type: "expense", balance: 300 });

    const result = await rows.page({
      where: gt(accountsTable.balance, 100),
      orderBy: desc(accountsTable.balance),
      limit: 1,
      page: 2,
    });
    const direct = await rows.findMany({
      where: gt(accountsTable.balance, 100),
      orderBy: desc(accountsTable.balance),
      limit: 1,
      offset: 1,
    });

    expect(result.data.map((row) => row.name)).toEqual(["Revenue"]);
    expect(result.data).toEqual(direct);
    expect(result.meta).toEqual({
      total: 2,
      page: 2,
      limit: 1,
      pages: 2,
    });
  });

  it("validates direct page windows", async () => {
    const { rows } = setupAccounts();

    await expect(rows.page({ limit: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(rows.page({ page: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it("infers table rows across reads and writes", async () => {
    type AccountRow = InferSelectModel<
      typeof accountsTable,
      { dbColumnNames: true }
    >;

    const { rows } = setupAccounts();
    const createdPromise = rows.create({ name: "Cash", type: "asset" });
    expectTypeOf(createdPromise).toEqualTypeOf<Promise<AccountRow>>();
    const created = await createdPromise;

    const foundPromise = rows.findMany({ limit: 1 });
    expectTypeOf(foundPromise).toEqualTypeOf<Promise<AccountRow[]>>();
    await foundPromise;

    const pagePromise = rows.page({ limit: 1 });
    expectTypeOf(pagePromise).toEqualTypeOf<
      Promise<PageRowsResult<typeof accountsTable>>
    >();
    await pagePromise;

    const getPromise = rows.get(String(created.id));
    expectTypeOf(getPromise).toEqualTypeOf<Promise<AccountRow>>();
    await getPromise;

    const updatePromise = rows.update(String(created.id), { balance: 125 });
    expectTypeOf(updatePromise).toEqualTypeOf<Promise<AccountRow>>();
    await updatePromise;

    const scan = rows.scan({ batchSize: 1 });
    expectTypeOf(scan).toEqualTypeOf<AsyncIterable<AccountRow>>();
    for await (const row of scan) {
      expectTypeOf(row).toEqualTypeOf<AccountRow>();
    }

    const deletePromise = rows.delete(String(created.id));
    expectTypeOf(deletePromise).toEqualTypeOf<Promise<AccountRow>>();
    await deletePromise;

    const batchPromise = rows.create([{ name: "Revenue", type: "revenue" }]);
    expectTypeOf(batchPromise).toEqualTypeOf<Promise<AccountRow[]>>();
    await batchPromise;
  });

  it("scans with transport-free filtering, ordering, and bounded batches", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset" });
    await rows.create({ name: "Petty Cash", type: "asset" });
    await rows.create({ name: "Revenue", type: "revenue" });

    const scanned: Record<string, unknown>[] = [];
    for await (const row of rows.scan({
      where: eq(accountsTable.type, "asset"),
      orderBy: [asc(accountsTable.name), asc(accountsTable.id)],
      batchSize: 1,
    })) {
      scanned.push(row);
    }

    expect(scanned).toEqual([
      expect.objectContaining({ name: "Cash", type: "asset" }),
      expect.objectContaining({ name: "Petty Cash", type: "asset" }),
    ]);
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
    const ledger = sapportaTable({
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
    const documents = sapportaTable({
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

    const selected = await rows.findMany({ limit: 10 });
    const result = await rows.page();
    expect(selected.map((row) => row.title)).toEqual(["Visible"]);
    expect(result.data.map((row) => row.title)).toEqual(["Visible"]);
    expect(result.data).toEqual(selected);
    expect(result.meta.total).toBe(1);
    await expect(rows.get("2")).rejects.toBeInstanceOf(RowNotFoundError);
    await expect(
      rows.update("2", { title: "Still hidden" }),
    ).rejects.toBeInstanceOf(RowNotFoundError);
    await expect(rows.delete("2")).rejects.toBeInstanceOf(RowNotFoundError);
  });

  it("looks up row labels inside row scope", async () => {
    const { rows } = setupAccounts();
    await rows.create({ name: "Cash", type: "asset", balance: 100 });
    await rows.create({ name: "Revenue", type: "revenue", balance: 250 });
    await rows.create({ name: "Rent", type: "expense", balance: 300 });

    await expect(rows.lookup({ ids: [1, 2] })).resolves.toEqual([
      {
        value: 1,
        label: "Cash",
        meta: { id: 1, name: "Cash", type: "asset", balance: 100 },
      },
      {
        value: 2,
        label: "Revenue",
        meta: { id: 2, name: "Revenue", type: "revenue", balance: 250 },
      },
    ]);
    await expect(rows.lookup({ search: "re" })).resolves.toEqual([
      {
        value: 2,
        label: "Revenue",
        meta: { id: 2, name: "Revenue", type: "revenue", balance: 250 },
      },
      {
        value: 3,
        label: "Rent",
        meta: { id: 3, name: "Rent", type: "expense", balance: 300 },
      },
    ]);
    await expect(rows.lookup({ search: "re", limit: 1 })).resolves.toEqual([
      {
        value: 2,
        label: "Revenue",
        meta: { id: 2, name: "Revenue", type: "revenue", balance: 250 },
      },
    ]);
    await expect(rows.lookup({ limit: 2 })).resolves.toEqual([
      {
        value: 1,
        label: "Cash",
        meta: { id: 1, name: "Cash", type: "asset", balance: 100 },
      },
      {
        value: 2,
        label: "Revenue",
        meta: { id: 2, name: "Revenue", type: "revenue", balance: 250 },
      },
    ]);
    await expect(rows.lookup({ search: "asset" })).resolves.toEqual([]);
    await expect(
      rows.lookup({ search: "asset", fields: [accountsTable.type] }),
    ).resolves.toEqual([
      {
        value: 1,
        label: "Cash",
        meta: { id: 1, name: "Cash", type: "asset", balance: 100 },
      },
    ]);
    await expect(rows.lookup({ search: "250" })).resolves.toEqual([]);
    await expect(
      rows.lookup({ search: "250", fields: [accountsTable.balance] }),
    ).resolves.toEqual([
      {
        value: 2,
        label: "Revenue",
        meta: { id: 2, name: "Revenue", type: "revenue", balance: 250 },
      },
    ]);
  });

  it("rejects non-numeric lookup ids for numeric primary keys", async () => {
    const { rows } = setupAccounts();

    await expect(rows.lookup({ ids: ["not-a-number"] })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it("returns public field names and excludes hidden fields", async () => {
    const contactsTable = sqliteTable("contacts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      displayName: text("display_name").notNull(),
      secretCode: text("secret_code").notNull(),
    });
    const contacts = sapportaTable({
      drizzle: contactsTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["display_name"],
        columns: { secret_code: { visuallyHidden: true } },
      },
    });
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_name TEXT NOT NULL,
        secret_code TEXT NOT NULL
      );
      INSERT INTO contacts (display_name, secret_code)
      VALUES ('Alice Adams', 'internal-7305');
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [contacts] }),
      contacts,
    );
    type ContactRow = InferSelectModel<
      typeof contactsTable,
      { dbColumnNames: true }
    >;
    const foundPromise = rows.findMany({ limit: 1 });
    expectTypeOf(foundPromise).toEqualTypeOf<Promise<ContactRow[]>>();
    const [found] = await foundPromise;
    expectTypeOf(found!.display_name).toEqualTypeOf<string>();
    if (false) {
      // @ts-expect-error public rows use SQL names, not Drizzle property names.
      void found!.displayName;
    }

    await expect(rows.lookup({ ids: [1] })).resolves.toEqual([
      {
        value: 1,
        label: "Alice Adams",
        meta: { id: 1, display_name: "Alice Adams" },
      },
    ]);
    await expect(rows.lookup({ search: "internal-7305" })).resolves.toEqual([]);
    await expect(
      rows.lookup({
        search: "internal-7305",
        fields: [contactsTable.secretCode],
      }),
    ).rejects.toThrow(/not visible/);
  });

  it("keeps lookup ids as strings for text primary keys", async () => {
    const agentsTable = sqliteTable("agents", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
    });
    const agents = sapportaTable({
      drizzle: agentsTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["name"],
      },
    });

    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO agents (id, name) VALUES ('001', 'Agent One');
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [agents] }),
      agents,
    );

    await expect(rows.lookup({ ids: ["001"] })).resolves.toEqual([
      {
        value: "001",
        label: "Agent One",
        meta: { id: "001", name: "Agent One" },
      },
    ]);
  });
});
