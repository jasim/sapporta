import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sapportaTable, treePath } from "../schema/table.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { computeFields } from "./computed-fields.js";
import { rowLabeller, rowLabelSql } from "./row-label.js";
import { treePathRelation, type TreePathRelationOptions } from "./tree-path.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: real("code"),
  name: text("name"),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
});

function setup() {
  const accounts = sapportaTable({
    drizzle: accountsTable,
    meta: {
      rowLabelColumns: ["code", "name"],
      tree: { parentColumn: "parent_id" },
    },
    computed: {
      parentPath: treePath(),
      slashPath: treePath({ separator: " / " }),
      namePath: treePath({ column: "name" }),
    },
  });
  const { sqlite, db } = createTestDb();
  sqlite.exec(`
    CREATE TABLE accounts (
      id integer PRIMARY KEY AUTOINCREMENT,
      code real,
      name text,
      parent_id integer REFERENCES accounts(id),
      workspace_id text NOT NULL,
      scoped_to_user_id text NOT NULL
    );
  `);
  const auth = createTestAuthContext({ tables: [accounts] });
  const insert = sqlite.prepare(
    "INSERT INTO accounts (code, name, parent_id, workspace_id, scoped_to_user_id) VALUES (?, ?, ?, 'workspace-1', ?)",
  );
  const add = (
    code: number | null,
    name: string | null,
    parent: string | null,
    user = "user-1",
  ) =>
    String(
      insert.run(code, name, parent === null ? null : Number(parent), user)
        .lastInsertRowid,
    );
  const relation = (options?: TreePathRelationOptions) => {
    const name = options?.name ?? "tree_paths";
    const rows = db.all<{
      id: number;
      parent_path: string | null;
      path: string;
    }>(
      sql`with recursive ${treePathRelation(accounts, auth, options)} select id, parent_path, path from ${sql.identifier(name)} order by id`,
    );
    return Object.fromEntries(rows.map((row) => [String(row.id), row]));
  };
  return { accounts, sqlite, db, auth, add, relation };
}

describe("rowLabelSql", () => {
  it("prints the same label as rowLabeller", () => {
    const { accounts, sqlite, db, add } = setup();
    add(4, "Cash", null);
    add(1.5, "", null);
    add(null, "Bank", null);
    add(null, null, null);
    add(0, "", null);
    add(12345678, "Big", null);

    const labeller = rowLabeller(accounts);
    const expected = (
      sqlite.prepare("SELECT * FROM accounts ORDER BY id").all() as Record<
        string,
        unknown
      >[]
    ).map((row) => labeller.label(row));
    const actual = db
      .all<{
        label: string;
      }>(
        sql`select ${rowLabelSql(accounts)} as label from accounts order by id`,
      )
      .map((row) => row.label);

    expect(expected).toEqual([
      "4 Cash",
      "1.5",
      "Bank",
      "4",
      "0",
      "12345678 Big",
    ]);
    expect(actual).toEqual(expected);
  });
});

describe("treePathRelation", () => {
  it("agrees with treePath()", async () => {
    const { accounts, db, auth, add, relation } = setup();
    const top = add(1, "Assets", null);
    const current = add(null, "Current", top);
    const cash = add(10, "", current);
    const till = add(null, "Till", cash);
    const hidden = add(2, "Hidden", null, "user-2");
    const orphan = add(null, "Orphan", hidden);
    const under = add(3.5, "Under", orphan);
    add(null, "Secret", orphan, "user-2");
    const ids = [top, current, cash, till, orphan, under];

    const values = await computeFields({
      db,
      auth,
      table: accounts,
      ids,
      names: ["parentPath", "slashPath", "namePath"],
    });

    const byDefault = relation();
    const bySlash = relation({ separator: " / ", name: "slash_paths" });
    const byName = relation({ column: "name" });
    expect(Object.keys(byDefault).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(byDefault[id]!.parent_path).toBe(values.parentPath![id]);
      expect(bySlash[id]!.parent_path).toBe(values.slashPath![id]);
      expect(byName[id]!.parent_path).toBe(values.namePath![id]);
    }

    expect(byDefault[till]).toMatchObject({
      parent_path: "1 Assets > Current > 10",
      path: "1 Assets > Current > 10 > Till",
    });
    expect(bySlash[under]).toMatchObject({
      parent_path: "Orphan",
      path: "Orphan / 3.5 Under",
    });
    expect(byName[till]!.path).toBe("Assets > Current >  > Till");
    expect(byDefault[top]).toMatchObject({
      parent_path: null,
      path: "1 Assets",
    });
  });

  it("gives no row to rows in a loop of parents", () => {
    const { sqlite, add, relation } = setup();
    const root = add(null, "Root", null);
    const a = add(null, "A", null);
    const b = add(null, "B", a);
    sqlite.prepare("UPDATE accounts SET parent_id = ? WHERE id = ?").run(b, a);

    expect(Object.keys(relation())).toEqual([root]);
  });

  it("refuses a table without meta.tree", () => {
    const flat = sapportaTable({
      drizzle: accountsTable,
      meta: { rowLabelColumns: ["name"] },
    });
    const auth = createTestAuthContext({ tables: [flat] });
    expect(() => treePathRelation(flat, auth)).toThrow(
      "does not declare meta.tree",
    );
  });
});
