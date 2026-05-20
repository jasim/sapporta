import { describe, expect, it, vi } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { createTableGridThemeContext } from "./table-grid-theme-context";
import type {
  TableForeignKeyLookupBundle,
  TableLookupRegistry,
} from "@/table/lookup/table-lookup-registry";

const ownerColumn: ColumnSchema = {
  name: "owner_id",
  kind: "number",
  foreignKey: { table: "users", column: "id" },
};

const bundle = {
  key: "orders.owner_id->users.id",
  sourceTable: "orders",
  sourceColumn: "owner_id",
  targetTable: "users",
  targetColumn: "id",
  valueLookup: {} as never,
  searchLookup: {} as never,
} satisfies TableForeignKeyLookupBundle;

describe("createTableGridThemeContext", () => {
  it("delegates FK bundle lookup to the table lookup registry", () => {
    const registry: TableLookupRegistry = {
      bundleFor: vi.fn(() => bundle),
      dispose: vi.fn(),
    };
    const context = createTableGridThemeContext(registry);

    expect(
      context.lookupBundleFor({ tableName: "orders", column: ownerColumn }),
    ).toBe(bundle);
    expect(registry.bundleFor).toHaveBeenCalledWith({
      sourceTable: "orders",
      column: ownerColumn,
    });
  });
});
