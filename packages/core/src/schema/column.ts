import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TableDef } from "./table.js";

export function columnBySqlName(
  table: TableDef,
  sqlName: string,
): SQLiteColumn | null {
  return (
    getTableConfig(table.drizzle).columns.find(
      (column) => column.name === sqlName,
    ) ?? null
  );
}

export function columnPropertyName(
  table: TableDef,
  column: SQLiteColumn,
): string | null {
  for (const [key, value] of Object.entries(
    table.drizzle as unknown as Record<string, unknown>,
  )) {
    if (value === column) return key;
  }
  return null;
}
