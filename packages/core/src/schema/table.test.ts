import { describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "./table.js";

describe("table metadata", () => {
  it("requires at least one row label column at runtime", () => {
    const accountsTable = sqliteTable("accounts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
    });

    expect(() =>
      sapportaTable({
        drizzle: accountsTable,
        meta: {
          rowLabelColumns: [] as unknown as [string, ...string[]],
        },
      }),
    ).toThrow('Table "accounts" must declare at least one row label column.');
  });

  it("rejects row label columns that are not on the table", () => {
    const accountsTable = sqliteTable("accounts", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
    });

    expect(() =>
      sapportaTable({
        drizzle: accountsTable,
        meta: { rowLabelColumns: ["display_name"] },
      }),
    ).toThrow(
      'Table "accounts" rowLabelColumns includes unknown column "display_name".',
    );
  });

  it("marks ownership columns as hidden presentation fields", () => {
    const recordsTable = sqliteTable("records", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      workspaceId: text("workspace_id").notNull(),
      scopedToUserId: text("scoped_to_user_id").notNull(),
      name: text("name").notNull(),
    });

    const records = sapportaTable({
      drizzle: recordsTable,
      meta: {
        rowLabelColumns: ["name"],
        columns: {
          workspace_id: { visuallyHidden: false },
          scoped_to_user_id: { visuallyHidden: false },
        },
      },
    });

    expect(records.meta.columns.workspace_id?.visuallyHidden).toBe(true);
    expect(records.meta.columns.scoped_to_user_id?.visuallyHidden).toBe(true);
  });
});
