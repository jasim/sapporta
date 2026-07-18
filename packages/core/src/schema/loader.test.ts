import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSchemas } from "./loader.js";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { getColumnEnumValues } from "./table-value-zod.js";

describe("loadSchemas()", () => {
  // Compiled fixtures — see tsconfig.fixtures.json and the root pretest script.
  const schemaDir = resolve(
    import.meta.dirname,
    "../../fixtures-dist/test-fixtures/schema",
  );

  it("loads TableDef exports from a directory", async () => {
    const { tables } = await loadSchemas(schemaDir);
    const accounts = tables.find((t) => t.sqlName === "accounts");
    expect(accounts).toBeDefined();
    expect(accounts!.meta.label).toBe("Accounts");
    const accountType = getTableConfig(accounts!.drizzle).columns.find(
      (column) => column.name === "account_type",
    );
    expect(accountType && getColumnEnumValues(accountType)).toEqual([
      "Asset",
      "Liability",
      "Equity",
      "Revenue",
      "Expense",
    ]);
  });

  it("silently skips non-TableDef exports", async () => {
    const { tables } = await loadSchemas(schemaDir);
    const tableNames = tables.map((t) => t.sqlName);
    expect(tableNames).toContain("accounts");
    expect(
      tables.every(
        (t) => typeof t.sqlName === "string" && typeof t.drizzle === "object",
      ),
    ).toBe(true);
  });

  it("skips .test.ts files", async () => {
    const { tables } = await loadSchemas(schemaDir);
    expect(tables.map((t) => t.sqlName)).toEqual(["accounts"]);
  });

  // SQLite has no native enum type. Enum values are expressed as
  // text({ enum: [...] }) in column definitions, so there's no
  // separate enum object to detect during loading.
});
