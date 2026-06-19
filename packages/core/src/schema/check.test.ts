import { describe, expect, it } from "vitest";
import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import {
  assertSchemaDefinitions,
  SchemaValidationError,
} from "./check.js";
import { table } from "./table.js";

describe("assertSchemaDefinitions", () => {
  it("accepts non-null numerics, nullable FKs, and explicit non-additive numerics", () => {
    const categoriesTable = sqliteTable("schema_check_categories", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
    });
    const productsTable = sqliteTable("schema_check_products", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      category_id: integer("category_id").references(() => categoriesTable.id),
      name: text("name").notNull(),
      quantity: real("quantity").notNull().default(0),
      rating_override: real("rating_override"),
    });

    const categories = table({
      drizzle: categoriesTable,
      meta: { rowLabelColumns: ["name"] },
    });
    const products = table({
      drizzle: productsTable,
      meta: {
        rowLabelColumns: ["name"],
        columns: { rating_override: { additive: false } },
      },
    });

    expect(() => assertSchemaDefinitions([categories, products])).not.toThrow();
  });

  it("throws a structured error for nullable additive numerics", () => {
    const accounts = table({
      drizzle: sqliteTable("schema_check_accounts", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        balance: real("balance"),
      }),
      meta: { rowLabelColumns: ["name"] },
    });

    expectSchemaIssues(() => assertSchemaDefinitions([accounts]), [
      {
        table: "schema_check_accounts",
        column: "balance",
        message: expect.stringContaining("Nullable numeric column"),
      },
    ]);
  });

  it("throws a structured error for Date-mode timestamps", () => {
    const events = table({
      drizzle: sqliteTable("schema_check_events", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        name: text("name").notNull(),
        occurred_at: integer("occurred_at", { mode: "timestamp" }),
      }),
      meta: { rowLabelColumns: ["name"] },
    });

    expectSchemaIssues(() => assertSchemaDefinitions([events]), [
      {
        table: "schema_check_events",
        column: "occurred_at",
        message: expect.stringContaining("Timestamp column using Date mode"),
      },
    ]);
  });
});

function expectSchemaIssues(
  action: () => void,
  expectedIssues: Array<{
    table: string;
    column: string;
    message: ReturnType<typeof expect.stringContaining>;
  }>,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SchemaValidationError);
  if (!(caught instanceof SchemaValidationError)) {
    throw new Error("Expected SchemaValidationError.");
  }
  expect(caught.issues).toMatchObject(expectedIssues);
}
