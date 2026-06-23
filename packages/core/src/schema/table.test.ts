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
});
