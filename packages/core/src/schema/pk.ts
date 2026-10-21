import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { RecordId } from "@sapporta/shared/record-id";
import { resolveColumnKind } from "./resolve-kind.js";
import type { TableDef } from "./table.js";

/** Resolve a table's primary-key column. Throws if the table has none — this
 *  signals a misconfigured schema and should never silently fall back to "id". */
export function findPkColumn(schema: TableDef) {
  const config = getTableConfig(schema.drizzle);
  const pk = config.columns.find((c) => c.primary);
  if (!pk) throw new Error(`Table "${schema.sqlName}" has no primary key`);
  return pk;
}

/**
 * Converts ids in their address form (`RecordId` strings) to the values the
 * primary-key column stores, so that they bind as numbers for an INTEGER key.
 */
export function primaryKeyValues(
  schema: TableDef,
  ids: readonly RecordId[],
): (string | number)[] {
  const pk = findPkColumn(schema);
  if (resolveColumnKind(schema, pk.name) !== "number") return [...ids];
  return ids.map((id) => {
    const value = Number(id);
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Id for numeric column "${schema.sqlName}.${pk.name}" must be a finite number, got ${JSON.stringify(id)}.`,
      );
    }
    return value;
  });
}
