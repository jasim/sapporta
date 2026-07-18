import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema, Row } from "@sapporta/shared/contracts";
import { createTableLookupSource, type TableLookupSource } from "./source";

export type LookupForColumn<TMeta = unknown> = (
  column: ColumnSchema,
) => LookupCapabilities<LookupValue, TMeta> | undefined;

export type LookupStore<TMeta = unknown> = {
  table(tableName: string): LookupCapabilities<LookupValue, TMeta>;
  foreignKey: LookupForColumn<TMeta>;
  requireForeignKey(args: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities<LookupValue, TMeta>;
  clear(): void;
};

export function createLookupStore(): LookupStore<Row> {
  const byTable = new Map<string, TableLookupSource>();

  function table(tableName: string): TableLookupSource {
    const existing = byTable.get(tableName);
    if (existing) return existing;

    const lookup = createTableLookupSource(tableName);
    byTable.set(tableName, lookup);
    return lookup;
  }

  function foreignKey(column: ColumnSchema): TableLookupSource | undefined {
    return column.foreignKey ? table(column.foreignKey.table) : undefined;
  }

  function requireForeignKey({
    tableName,
    column,
  }: {
    tableName: string;
    column: ColumnSchema;
  }): TableLookupSource {
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
