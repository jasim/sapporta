import type { TableDef } from "./table.js";
import { normalizeDataType } from "./normalize-datatype.js";
import type { ValueKind } from "@sapporta/shared/value-kind";

/**
 * Resolve a column's declared `ValueKind`.
 *
 * Factory-declared columns carry `kind` in `meta.columns[col].kind`.
 * Hand-declared Drizzle columns derive `ValueKind` from the dialect-normalized
 * data type, keeping raw Drizzle schemas a supported declaration style.
 *
 * Returns `undefined` only when the column name is not on the table.
 */
export function resolveColumnKind(
  schema: TableDef,
  column: string,
): ValueKind | undefined {
  const declared = schema.meta.columns?.[column]?.kind;
  if (declared) return declared;

  const cols = schema.drizzle as unknown as Record<
    string,
    { columnType?: string; dataType?: string } | undefined
  >;
  const col = cols[column];
  if (!col || !col.columnType || !col.dataType) return undefined;

  const dt = normalizeDataType({
    columnType: col.columnType,
    dataType: col.dataType,
  });
  switch (dt) {
    case "number":  return "number";
    case "boolean": return "boolean";
    case "date":    return "timestamp";
    case "string":  return "text";
    default:
      throw new Error(
        `resolveColumnKind: unmapped Drizzle dataType "${dt}" ` +
        `for column "${column}" (columnType "${col.columnType}"). ` +
        `Add an explicit mapping — data-type inference is not a catch-all.`,
      );
  }
}
