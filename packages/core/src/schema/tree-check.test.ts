import { describe, expect, it } from "vitest";
import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createTableCatalog } from "./catalog.js";
import { extractSchemas } from "./extract.js";
import { sapportaTable, type SapportaTableInputMeta } from "./table.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  secret: text("secret"),
  parent_id: integer("parent_id").references(
    (): AnySQLiteColumn => accountsTable.id,
  ),
  parent_code: text("parent_code").references(
    (): AnySQLiteColumn => accountsTable.code,
  ),
  logical_parent_id: integer("logical_parent_id"),
  required_parent_id: integer("required_parent_id").notNull(),
  group_id: integer("group_id").references(() => groupsTable.id),
});

const groupsTable = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

const groups = sapportaTable({
  drizzle: groupsTable,
  meta: { rowLabelColumns: ["name"] },
});

function accounts(meta: Partial<SapportaTableInputMeta> = {}) {
  return sapportaTable({
    drizzle: accountsTable,
    meta: {
      rowLabelColumns: ["name"],
      tree: { parentColumn: "parent_id" },
      columns: { secret: { visuallyHidden: true } },
      ...meta,
    },
  });
}

describe("meta.tree", () => {
  it("resolves defaults from the row label", () => {
    expect(accounts().meta.tree).toEqual({
      parentColumn: "parent_id",
      column: "name",
      defaultExpanded: true,
      matchContext: "ancestors-and-descendants",
    });
  });

  it("keeps declared options", () => {
    const def = accounts({
      tree: {
        parentColumn: "parent_id",
        column: "code",
        defaultExpanded: false,
        matchContext: "ancestors",
      },
    });
    expect(def.meta.tree).toEqual({
      parentColumn: "parent_id",
      column: "code",
      defaultExpanded: false,
      matchContext: "ancestors",
    });
  });

  it("rejects an unknown parent column", () => {
    expect(() => accounts({ tree: { parentColumn: "mother_id" } })).toThrow(
      'Table "accounts" tree.parentColumn names unknown column "mother_id".',
    );
  });

  it("rejects a parent column that cannot be null", () => {
    expect(() =>
      accounts({ tree: { parentColumn: "required_parent_id" } }),
    ).toThrow(/"required_parent_id" must be nullable/);
  });

  it("rejects an unknown or hidden tree column", () => {
    expect(() =>
      accounts({ tree: { parentColumn: "parent_id", column: "title" } }),
    ).toThrow('Table "accounts" tree.column names unknown column "title".');
    expect(() =>
      accounts({ tree: { parentColumn: "parent_id", column: "secret" } }),
    ).toThrow(/tree.column "secret" is hidden/);
  });

  it("rejects a table that also lists itself as a child", () => {
    expect(() =>
      accounts({
        children: [{ table: "accounts", foreignKey: "parent_id" }],
      }),
    ).toThrow(/also lists itself in meta.children/);
  });

  it("accepts a self foreign key to the primary key", () => {
    expect(() => createTableCatalog([accounts(), groups])).not.toThrow();
  });

  it("accepts a logical foreign key declared in meta.references", () => {
    const def = accounts({
      tree: { parentColumn: "logical_parent_id" },
      references: {
        logical_parent_id: { table: "accounts", column: "id" },
      },
    });
    expect(() => createTableCatalog([def, groups])).not.toThrow();
  });

  it("rejects a parent column that is not a foreign key", () => {
    expect(() =>
      createTableCatalog([
        accounts({ tree: { parentColumn: "logical_parent_id" } }),
        groups,
      ]),
    ).toThrow(
      /accounts.logical_parent_id: tree.parentColumn must be a foreign key to "accounts.id"/,
    );
  });

  it("rejects a foreign key to another table or to a non-key column", () => {
    expect(() =>
      createTableCatalog([
        accounts({ tree: { parentColumn: "group_id" } }),
        groups,
      ]),
    ).toThrow(/references "groups.id", but it must reference "accounts.id"/);
    expect(() =>
      createTableCatalog([
        accounts({ tree: { parentColumn: "parent_code" } }),
        groups,
      ]),
    ).toThrow(
      /references "accounts.code", but it must reference "accounts.id"/,
    );
  });

  it("reaches the browser in the table schema", () => {
    const [schema] = extractSchemas([accounts(), groups]);
    expect(schema?.tree).toEqual({
      parentColumn: "parent_id",
      column: "name",
      defaultExpanded: true,
      matchContext: "ancestors-and-descendants",
    });
    const [, flat] = extractSchemas([accounts(), groups]);
    expect(flat?.tree).toBeUndefined();
  });
});
