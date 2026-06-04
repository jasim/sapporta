import { describe, expect, it } from "vitest";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { table } from "../schema/table.js";
import { findRowLabelColumns, rowLabeller } from "./row-label.js";

const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
});

const accounts = table({
  drizzle: accountsTable,
  meta: { label: "Accounts" },
});

describe("findRowLabelColumns", () => {
  it("returns first text non-PK column", () => {
    expect(findRowLabelColumns(accounts)).toEqual(["name"]);
  });

  it("skips FK columns", () => {
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      account_id: integer("account_id")
        .notNull()
        .references(() => accountsTable.id),
      description: text("description").notNull(),
    });
    const invoices = table({ drizzle: invoicesTable, meta: {} });
    expect(findRowLabelColumns(invoices)).toEqual(["description"]);
  });

  it("returns null when no text column exists", () => {
    const numbersTable = sqliteTable("numbers", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      value: integer("value").notNull(),
    });
    const numbers = table({ drizzle: numbersTable, meta: {} });
    expect(findRowLabelColumns(numbers)).toBeNull();
  });

  it("honors meta.rowLabelColumns override", () => {
    const ordersTable = sqliteTable("orders", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      first_name: text("first_name").notNull(),
      last_name: text("last_name").notNull(),
    });
    const orders = table({
      drizzle: ordersTable,
      meta: { rowLabelColumns: ["first_name", "last_name"] },
    });
    expect(findRowLabelColumns(orders)).toEqual(["first_name", "last_name"]);
  });
});

describe("rowLabeller", () => {
  it("concatenates display columns with a space", () => {
    const peopleTable = sqliteTable("people", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      first_name: text("first_name").notNull(),
      last_name: text("last_name").notNull(),
    });
    const people = table({
      drizzle: peopleTable,
      meta: { rowLabelColumns: ["first_name", "last_name"] },
    });

    const label = rowLabeller(people).label;
    expect(label({ id: 1, first_name: "Ada", last_name: "Lovelace" })).toBe(
      "Ada Lovelace",
    );
  });
});
