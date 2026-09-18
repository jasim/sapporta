import { describe, expect, it } from "vitest";
import { asc, desc, eq, inArray, like } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import {
  scopedRows,
  type PageRowsInput,
  type TreeMatchInput,
} from "./scoped-rows.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  name: text("name").notNull(),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

function accountsDef(matchContext?: "ancestors") {
  return sapportaTable({
    drizzle: accountsTable,
    meta: {
      rowLabelColumns: ["name"],
      tree: {
        parentColumn: "parent_id",
        ...(matchContext ? { matchContext } : {}),
      },
    },
  });
}

const flatAccounts = sapportaTable({
  drizzle: accountsTable,
  meta: { rowLabelColumns: ["name"] },
});

// Assets(1) > Checking(2), Savings(3)
// Expenses(4) > Taxes(5) > Federal(6) > Payroll(7), State(8)
// Income(9)
// Another user's row (10) is the parent of this user's Orphan(11).
const seed = [
  [1, "workspace-1", "user-1", "Assets", null],
  [2, "workspace-1", "user-1", "Checking", 1],
  [3, "workspace-1", "user-1", "Savings", 1],
  [4, "workspace-1", "user-1", "Expenses", null],
  [5, "workspace-1", "user-1", "Taxes", 4],
  [6, "workspace-1", "user-1", "Federal", 5],
  [7, "workspace-1", "user-1", "Payroll", 6],
  [8, "workspace-1", "user-1", "State", 5],
  [9, "workspace-1", "user-1", "Income", null],
  [10, "workspace-1", "user-2", "Private", null],
  [11, "workspace-1", "user-1", "Orphan", 10],
] as const;

function setup(def = accountsDef(), extraRows: string = "") {
  const { db, sqlite } = createTestDb();
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES accounts(id),
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, parent_id) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of seed) insert.run(...row);
  if (extraRows) sqlite.exec(extraRows);
  return scopedRows(db, createTestAuthContext({ tables: [def] }), def);
}

const names = (rows: readonly { name: unknown }[]) =>
  rows.map((row) => row.name);

// Resolve a tree match, then page over the rows it selects, the way the list
// endpoint does.
async function matchPage(
  rows: ReturnType<typeof setup>,
  input: TreeMatchInput,
  window: Omit<PageRowsInput, "where"> = {},
) {
  const match = await rows.treeMatch(input);
  const page = await rows.page({ ...window, where: match.where });
  return { ...match, data: page.data, meta: page.meta };
}

describe("tree matches", () => {
  it("returns a deep match with its ancestors and its subtree", async () => {
    const rows = setup();
    const result = await matchPage(
      rows,
      {
        match: eq(accountsTable.name, "Federal"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id) },
    );
    expect(names(result.data)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Payroll",
    ]);
    expect(result.meta.total).toBe(4);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual(["4", "5"]);
  });

  it("returns only ancestors in ancestors mode", async () => {
    const rows = setup();
    const result = await matchPage(
      rows,
      { match: eq(accountsTable.name, "Taxes"), matchContext: "ancestors" },
      { orderBy: asc(accountsTable.id) },
    );
    expect(names(result.data)).toEqual(["Expenses", "Taxes"]);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual(["4"]);
  });

  it("does not report a match inside a matched subtree as context", async () => {
    const rows = setup();
    const result = await matchPage(
      rows,
      {
        match: like(accountsTable.name, "%a%"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id) },
    );
    // Assets, Savings, Taxes, Federal, Payroll, State, and Orphan match.
    // Checking is in the Assets subtree, Expenses is context, and Orphan's
    // parent belongs to another user.
    expect(names(result.data)).toEqual([
      "Assets",
      "Checking",
      "Savings",
      "Expenses",
      "Taxes",
      "Federal",
      "Payroll",
      "State",
      "Orphan",
    ]);
    expect(result.matchCount).toBe(7);
    expect(result.contextIds).toEqual(["4"]);
  });

  it("orders the result by the requested sort", async () => {
    const rows = setup();
    const result = await matchPage(
      rows,
      {
        match: eq(accountsTable.name, "State"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: desc(accountsTable.name) },
    );
    expect(names(result.data)).toEqual(["Taxes", "State", "Expenses"]);
  });

  it("pages over matches and context rows together", async () => {
    const rows = setup();
    const result = await matchPage(
      rows,
      {
        match: eq(accountsTable.name, "Federal"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id), page: 2, limit: 3 },
    );
    expect(names(result.data)).toEqual(["Payroll"]);
    expect(result.meta).toMatchObject({ total: 4, pages: 2 });
  });

  it("selects rows that other reads can use", async () => {
    const rows = setup();
    const match = await rows.treeMatch({
      match: eq(accountsTable.name, "Taxes"),
      matchContext: "ancestors-and-descendants",
    });
    expect(await rows.count({ where: match.where })).toBe(5);
    const found = await rows.findMany({
      where: match.where,
      orderBy: asc(accountsTable.id),
      limit: 2,
    });
    expect(names(found)).toEqual(["Expenses", "Taxes"]);
  });

  it("never returns or walks through a row outside the row scope", async () => {
    const rows = setup(
      accountsDef(),
      // Another user's row sits between this user's rows.
      `INSERT INTO accounts VALUES (12, 'workspace-1', 'user-2', 'Hidden', 9, 0);
       INSERT INTO accounts VALUES (13, 'workspace-1', 'user-1', 'Visible', 12, 0);`,
    );
    const orphan = await matchPage(rows, {
      match: eq(accountsTable.name, "Orphan"),
      matchContext: "ancestors-and-descendants",
    });
    expect(names(orphan.data)).toEqual(["Orphan"]);
    expect(orphan.matchCount).toBe(1);
    expect(orphan.contextIds).toEqual([]);

    const visible = await matchPage(rows, {
      match: eq(accountsTable.name, "Visible"),
      matchContext: "ancestors-and-descendants",
    });
    // Income is above Hidden, so the walk stops before reaching it.
    expect(names(visible.data)).toEqual(["Visible"]);

    const income = await matchPage(rows, {
      match: eq(accountsTable.name, "Income"),
      matchContext: "ancestors-and-descendants",
    });
    // Hidden is not returned, and the descent does not pass through it.
    expect(names(income.data)).toEqual(["Income"]);
  });

  it("ends the walk at a loop in the data", async () => {
    const rows = setup(
      accountsDef(),
      `INSERT INTO accounts VALUES (20, 'workspace-1', 'user-1', 'Loop A', NULL, 0);
       INSERT INTO accounts VALUES (21, 'workspace-1', 'user-1', 'Loop B', 20, 0);
       UPDATE accounts SET parent_id = 21 WHERE id = 20;`,
    );
    const result = await matchPage(
      rows,
      {
        match: eq(accountsTable.name, "Loop A"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id) },
    );
    expect(names(result.data)).toEqual(["Loop A", "Loop B"]);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual([]);
  });

  it("keeps descendants that fail the fixed condition out of a matched subtree", async () => {
    const rows = setup(
      accountsDef(),
      "UPDATE accounts SET archived = 1 WHERE name IN ('State', 'Payroll');",
    );
    const result = await matchPage(
      rows,
      {
        fixed: eq(accountsTable.archived, false),
        match: eq(accountsTable.name, "Taxes"),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id) },
    );
    expect(names(result.data)).toEqual(["Expenses", "Taxes", "Federal"]);
    expect(result.meta.total).toBe(3);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual(["4"]);
  });

  it("stops the ancestor walk at a row that fails the fixed condition", async () => {
    const rows = setup(
      accountsDef(),
      "UPDATE accounts SET archived = 1 WHERE name = 'Taxes';",
    );
    const result = await matchPage(
      rows,
      {
        fixed: eq(accountsTable.archived, false),
        match: eq(accountsTable.name, "Payroll"),
        matchContext: "ancestors",
      },
      { orderBy: asc(accountsTable.id) },
    );
    // Expenses is above Taxes, so the walk ends before reaching it.
    expect(names(result.data)).toEqual(["Federal", "Payroll"]);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual(["6"]);
  });

  it("counts only the matches that satisfy the fixed condition", async () => {
    const rows = setup(
      accountsDef(),
      "UPDATE accounts SET archived = 1 WHERE name = 'State';",
    );
    const result = await matchPage(
      rows,
      {
        fixed: eq(accountsTable.archived, false),
        match: inArray(accountsTable.name, ["Payroll", "State"]),
        matchContext: "ancestors-and-descendants",
      },
      { orderBy: asc(accountsTable.id) },
    );
    // State matches but is archived, so only Payroll counts.
    expect(names(result.data)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Payroll",
    ]);
    expect(result.matchCount).toBe(1);
    expect(result.contextIds).toEqual(["4", "5", "6"]);
  });

  it("refuses a tree match on a table without meta.tree", async () => {
    const rows = setup(flatAccounts);
    await expect(
      rows.treeMatch({
        match: eq(accountsTable.name, "Taxes"),
        matchContext: "ancestors",
      }),
    ).rejects.toThrow(/does not declare meta.tree/);
  });
});
