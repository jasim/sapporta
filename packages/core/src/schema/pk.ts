import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "./table.js";

/** Resolve a table's primary-key column. Throws if the table has none — this
 *  signals a misconfigured schema and should never silently fall back to "id". */
export function findPkColumn(schema: TableDef) {
  const config = getTableConfig(schema.drizzle);
  const pk = config.columns.find((c) => c.primary);
  if (!pk) throw new Error(`Table "${schema.sqlName}" has no primary key`);
  return pk;
}
