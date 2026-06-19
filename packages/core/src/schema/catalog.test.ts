import { describe, it, expect } from "vitest";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { table } from "./table.js";
import { createTableCatalog } from "./catalog.js";

function makeTable(name: string) {
  return table({
    drizzle: sqliteTable(name, {
      id: integer("id").primaryKey({ autoIncrement: true }),
      name: text("name").notNull(),
    }),
    meta: { rowLabelColumns: ["name"] },
  });
}

describe("createTableCatalog", () => {
  it("keeps loaded tables in order and resolves by SQL name", () => {
    const accounts = makeTable("accounts");
    const invoices = makeTable("invoices");
    const catalog = createTableCatalog([accounts, invoices]);

    expect(catalog.tables.map((def) => def.sqlName)).toEqual([
      "accounts",
      "invoices",
    ]);
    expect(catalog.get("accounts")).toBe(accounts);
    expect(catalog.get("invoices")).toBe(invoices);
    expect(catalog.get("unknown")).toBeUndefined();
    expect(catalog.has("accounts")).toBe(true);
    expect(catalog.has("unknown")).toBe(false);
  });

  it("rejects duplicate SQL table names", () => {
    const first = makeTable("accounts");
    const second = makeTable("accounts");

    expect(() => createTableCatalog([first, second])).toThrow(
      'Duplicate table schema "accounts" loaded.',
    );
  });
});
