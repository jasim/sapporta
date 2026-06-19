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
  meta: { label: "Accounts", rowLabelColumns: ["name"] },
});

describe("findRowLabelColumns", () => {
  it("returns declared row label columns", () => {
    expect(findRowLabelColumns(accounts)).toEqual(["name"]);
  });

  it("supports FK tables when a semantic label column is declared", () => {
    const invoicesTable = sqliteTable("invoices", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      account_id: integer("account_id")
        .notNull()
        .references(() => accountsTable.id),
      description: text("description").notNull(),
    });
    const invoices = table({
      drizzle: invoicesTable,
      meta: { rowLabelColumns: ["description"] },
    });
    expect(findRowLabelColumns(invoices)).toEqual(["description"]);
  });

  it("allows minimal tables to declare their primary key as the label", () => {
    const numbersTable = sqliteTable("numbers", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      value: integer("value").notNull(),
    });
    const numbers = table({
      drizzle: numbersTable,
      meta: { rowLabelColumns: ["id"] },
    });
    expect(findRowLabelColumns(numbers)).toEqual(["id"]);
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

  it("falls back to the primary key when declared label values are empty", () => {
    const peopleTable = sqliteTable("empty_label_people", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name"),
    });
    const people = table({
      drizzle: peopleTable,
      meta: { rowLabelColumns: ["name"] },
    });

    expect(rowLabeller(people).label({ id: 42, name: "" })).toBe("42");
  });
});
