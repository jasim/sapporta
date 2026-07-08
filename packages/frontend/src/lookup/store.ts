import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { createTableLookupSource } from "./source";

export type LookupForColumn = (
  column: ColumnSchema,
) => LookupCapabilities | undefined;

export type LookupStore = {
  table(tableName: string): LookupCapabilities;
  foreignKey: LookupForColumn;
  requireForeignKey(args: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities;
  clear(): void;
};

export function createLookupStore(): LookupStore {
  const byTable = new Map<string, LookupCapabilities>();

  function table(tableName: string): LookupCapabilities {
    const existing = byTable.get(tableName);
    if (existing) return existing;

    const lookup = createTableLookupSource(tableName);
    byTable.set(tableName, lookup);
    return lookup;
  }

  function foreignKey(column: ColumnSchema): LookupCapabilities | undefined {
    return column.foreignKey ? table(column.foreignKey.table) : undefined;
  }

  function requireForeignKey({
    tableName,
    column,
  }: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities {
    const lookup = foreignKey(column);
    if (lookup) return lookup;

    throw new Error(
      `Column '${tableName}.${column.name}' is not a foreign-key column.`,
    );
  }

  return {
    table,
    foreignKey,
    requireForeignKey,
    clear() {
      byTable.clear();
    },
  };
}
