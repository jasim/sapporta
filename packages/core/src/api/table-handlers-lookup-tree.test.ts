/**
 * Tree lookups (`/tables/:t/_lookup_tree`): a tree table's choices with the
 * ancestors that place them, depth-first, for a tree picker. Also the tree's
 * `rootOrder` on list reads, and the `tree.path` declaration.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { TsRestApi } from "@sapporta/honest";
import {
  MAX_LOOKUP_TREE_ROWS,
  MAX_PAGE_SIZE,
  type LookupTreeEntry,
} from "@sapporta/shared/contracts";
import { createTableCatalog } from "../schema/catalog.js";
import { sapportaTable } from "../schema/table.js";
import { treePath } from "../rows/tree-path.js";
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
    defaultSort: asc(accountsTable.name),
    tree: {
      parentColumn: "parent_id",
      rootOrder: {
        column: "account_type",
        values: ["Asset", "Liability", "Expense"],
      },
      path: "parentPath",
    },
  },
  computed: { parentPath: treePath({ separator: " / " }) },
});

let api: TsRestApi<SapportaEnv, TablesDocContext>;
let add: (name: string, type: string, parent?: number) => number;
let exec: (sql: string) => void;

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
  `);
  const insert = sqlite.prepare(
    "INSERT INTO accounts (name, account_type, parent_id, workspace_id, scoped_to_user_id) VALUES (?, ?, ?, 'workspace-1', 'user-1')",
  );
  add = (name, type, parent) =>
    Number(insert.run(name, type, parent ?? null).lastInsertRowid);
  exec = (sql) => sqlite.exec(sql);
  const catalog = createTableCatalog([accounts]);
  const auth = createTestAuthContext({ tables: [accounts] });
  api = new TsRestApi<SapportaEnv, TablesDocContext>();
  mountTables(
    api,
    catalog,
    makeAuthorizedTableHandlers(catalog, db, { guard: () => auth }),
  );
});

async function tree(query = "") {
  const res = await api.request(`/tables/accounts/_lookup_tree?${query}`);
  const body = (await res.json()) as {
    entries?: LookupTreeEntry[];
    computed?: Record<string, Record<string, unknown>>;
    code?: string;
  };
  return { status: res.status, body };
}

// One line per row: its depth as indentation, its name, and its role when it
// is not a choice.
function drawn(entries: readonly LookupTreeEntry[] | undefined): string[] {
  return (entries ?? []).map(
    (entry) =>
      `${"  ".repeat(entry.depth)}${entry.label}${entry.role === "choice" ? "" : ` (${entry.role})`}`,
  );
}

// Expenses > Car > Fuel; Expenses > Kitchen; Cash; Card (a liability).
function addChart() {
  const expenses = add("Expenses", "Expense");
  const car = add("Car", "Expense", expenses);
  const fuel = add("Fuel", "Expense", car);
  add("Kitchen", "Expense", expenses);
  add("Cash", "Asset");
  add("Card", "Liability");
  return { expenses, car, fuel };
}

describe("tree lookups", () => {
  it("returns the whole tree depth-first, roots in rootOrder", async () => {
    addChart();
    const { status, body } = await tree();
    expect(status).toBe(200);
    expect(drawn(body.entries)).toEqual([
      "Cash",
      "Card",
      "Expenses",
      "  Car",
      "    Fuel",
      "  Kitchen",
    ]);
  });

  it("greys the ancestors a filter leaves out, and drops empty branches", async () => {
    const expenses = add("Expenses", "Expense");
    const car = add("Car", "Expense", expenses);
    add("Fuel", "Fuel", car);
    // Nothing under Kitchen passes the filter, so the branch is left out.
    const kitchen = add("Kitchen", "Expense", expenses);
    add("Pantry", "Expense", kitchen);
    add("Cash", "Asset");

    const { body } = await tree("filter[account_type][eq]=Fuel");
    expect(drawn(body.entries)).toEqual([
      "Expenses (context)",
      "  Car (context)",
      "    Fuel",
    ]);
  });

  it("shows the notUnder row where it sits, without its branch", async () => {
    const { car } = addChart();
    const { body } = await tree(`notUnder=${car}`);
    expect(drawn(body.entries)).toEqual([
      "Cash",
      "Card",
      "Expenses",
      "  Car (editing)",
      "  Kitchen",
    ]);
  });

  it("places the notUnder row under greyed ancestors when a filter leaves them out", async () => {
    const { car } = addChart();
    const { body } = await tree(
      `notUnder=${car}&filter[account_type][eq]=Asset`,
    );
    expect(drawn(body.entries)).toEqual([
      "Cash",
      "Expenses (context)",
      "  Car (editing)",
    ]);
  });

  it("returns every row of a tree larger than one page", async () => {
    const top = add("Top", "Asset");
    exec(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MAX_PAGE_SIZE + 200})
       INSERT INTO accounts (name, account_type, parent_id, workspace_id, scoped_to_user_id)
       SELECT printf('Child %05d', i), 'Asset', ${top}, 'workspace-1', 'user-1' FROM n`,
    );
    const { status, body } = await tree();
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(MAX_PAGE_SIZE + 201);
    expect(body.entries?.at(-1)).toMatchObject({
      label: `Child ${String(MAX_PAGE_SIZE + 200).padStart(5, "0")}`,
      depth: 1,
    });
  });

  it("refuses a tree larger than MAX_LOOKUP_TREE_ROWS instead of cutting it", async () => {
    exec(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i <= ${MAX_LOOKUP_TREE_ROWS})
       INSERT INTO accounts (name, account_type, parent_id, workspace_id, scoped_to_user_id)
       SELECT 'Row ' || i, 'Asset', NULL, 'workspace-1', 'user-1' FROM n`,
    );
    const { status, body } = await tree();
    expect(status).toBe(400);
    expect(body.code).toBe("TREE_TOO_LARGE");
  });

  it("carries the tree path with the entries", async () => {
    const { fuel } = addChart();
    const { body } = await tree("computed=parentPath");
    expect(body.computed?.parentPath?.[String(fuel)]).toBe("Expenses / Car");
  });

  it("rejects an unknown filter column", async () => {
    expect((await tree("filter[nope][eq]=1")).status).toBe(400);
    expect((await tree("q=cash")).status).toBe(400);
  });
});

describe("tree searches", () => {
  async function matches(query: string) {
    const res = await api.request(
      `/tables/accounts/_lookup?computed=parentPath&${query}`,
    );
    const body = (await res.json()) as {
      entries: { value: number; label: string }[];
      computed: { parentPath: Record<string, string | null> };
    };
    return body.entries.map((entry) => [
      body.computed.parentPath[String(entry.value)],
      entry.label,
    ]);
  }

  it("lists the matches flat, each with its parent path", async () => {
    const { car } = addChart();
    expect(await matches("q=fu")).toEqual([["Expenses / Car", "Fuel"]]);
    // Under the edited row, Fuel is not a choice.
    expect(await matches(`q=fu&notUnder=${car}`)).toEqual([]);
  });
});

describe("rootOrder on the table's tree", () => {
  async function rows(query: string) {
    const res = await api.request(`/tables/accounts?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: number; name: string; parent_id: number | null }[];
    };
    return body.data;
  }
  const names = async (query: string) =>
    (await rows(query)).map((row) => row.name);

  // The grid groups a tree read's rows by parent, keeping their order, so
  // only the order of siblings matters.
  it("orders a tree read's top-level rows, then each level by defaultSort", async () => {
    const { expenses } = addChart();
    add("Bank", "Asset");
    add("Bills", "Expense", expenses);
    const read = await rows("tree=ancestors-and-descendants&limit=1000");
    const childrenOf = (parent: number | null) =>
      read.filter((row) => row.parent_id === parent).map((row) => row.name);
    expect(childrenOf(null)).toEqual(["Bank", "Cash", "Card", "Expenses"]);
    expect(childrenOf(expenses)).toEqual(["Bills", "Car", "Kitchen"]);
  });

  it("leaves a flat read, and a sort the user picks, alone", async () => {
    addChart();
    const byName = ["Car", "Card", "Cash", "Expenses", "Fuel", "Kitchen"];
    expect(await names("limit=1000")).toEqual(byName);
    expect(
      await names("tree=ancestors-and-descendants&sort=name&limit=1000"),
    ).toEqual(byName);
  });
});

describe("tree declarations", () => {
  it("lists the path field and its separator in the table schema", () => {
    expect(accounts.meta.tree).toMatchObject({
      path: "parentPath",
      pathSeparator: " / ",
      rootOrder: {
        column: "account_type",
        values: ["Asset", "Liability", "Expense"],
      },
    });
  });

  it("rejects a path that is not a treePath() field, and an unknown rootOrder column", () => {
    expect(() =>
      sapportaTable({
        drizzle: accountsTable,
        meta: {
          rowLabelColumns: ["name"],
          tree: { parentColumn: "parent_id", path: "name" },
        },
      }),
    ).toThrow(/must name a computed field made with treePath\(\)/);
    expect(() =>
      sapportaTable({
        drizzle: accountsTable,
        meta: {
          rowLabelColumns: ["name"],
          tree: {
            parentColumn: "parent_id",
            rootOrder: { column: "kind", values: ["a"] },
          },
        },
      }),
    ).toThrow(/rootOrder names unknown column "kind"/);
  });
});
