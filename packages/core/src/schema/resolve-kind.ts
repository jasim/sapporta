import type { TableDef } from "./table.js";
import { normalizeDataType } from "./normalize-datatype.js";
import type { ValueKind } from "@sapporta/shared/value-kind";
import { getTableConfig } from "drizzle-orm/sqlite-core";

/**
 * Resolve a column's declared `ValueKind`.
 *
 * Factory-declared columns carry `kind` in `meta.columns[col].kind`.
 * Hand-declared Drizzle columns derive `ValueKind` from the dialect-normalized
 * data type, keeping raw Drizzle schemas a supported declaration style.
 *
 * This function is the semantic kind authority for server validation, query
 * behavior, and emitted frontend metadata. `normalizeDataType()` is used only
 * as the fallback implementation for raw Drizzle columns; consumers do not
 * maintain independent storage-type-to-kind mappings.
 *
 * Returns `undefined` only when the column name is not on the table.
 */
export function resolveColumnKind(
  schema: TableDef,
  column: string,
): ValueKind | undefined {
  const declared = schema.meta.columns[column]?.kind;
  if (declared) return declared;

  const col = getTableConfig(schema.drizzle).columns.find(
    (candidate) => candidate.name === column,
  );
  if (!col) return undefined;

  const dt = normalizeDataType({
    columnType: col.columnType,
    dataType: col.dataType,
  });
  switch (dt) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "timestamp";
    case "string":
      return "text";
    default:
      throw new Error(
        `resolveColumnKind: unmapped Drizzle dataType "${dt}" ` +
          `for column "${column}" (columnType "${col.columnType}"). ` +
          `Add an explicit mapping — data-type inference is not a catch-all.`,
      );
  }
}
