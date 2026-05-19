import type { RowId } from "@sapporta/shared/row-id";
import type { TableSchema, Row } from "@sapporta/shared/contracts";
export type { RowId };

/** Resolve the row's primary-key value as a string. The PK column is whatever
 *  the schema marks as `primary`; throws if the schema declares no PK. */
export function getRowId(row: Row, schema: TableSchema): RowId {
  const pk = schema.columns.find((c) => c.primary);
  if (!pk) throw new Error(`Table "${schema.name}" has no primary key`);
  return String(row[pk.name]);
}
