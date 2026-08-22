/**
 * The final table-write path before Drizzle.
 *
 * Callers supply records keyed by public SQL column names. API callers normally
 * arrive through row security, which has already enforced field ownership,
 * merged trusted values, and checked reference visibility. `parseTableWrite()`
 * remains authoritative for value structure and application validation. The
 * parsed output is translated to Drizzle property names only for the database
 * call, and returned rows are translated back to public SQL names.
 */

import { and, eq, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import type { RecordId } from "@sapporta/shared/record-id";
import { findPkColumn } from "../schema/pk.js";
import { parseTableWrite } from "./validate.js";
import { ValidationError } from "../errors.js";
import { resolveRowFields } from "./row-fields.js";

/**
 * Insert a new row using Drizzle's table API.
 */
export async function insertRow(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return insertRowSync(schema, db, record);
}

export function insertRowSync(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const fields = resolveRowFields(schema, Object.keys(record));
  const result = db
    .insert(schema.drizzle)
    .values(
      fields.toDatabaseValues(record) as typeof schema.drizzle.$inferInsert,
    )
    .returning()
    .all() as Record<string, unknown>[];

  return allRowFields(schema).pick(result[0] as Record<string, unknown>);
}

/**
 * Update an existing row using Drizzle's table API.
 */
export async function updateRow(
  schema: TableDef,
  db: BetterSQLite3Database,
  id: RecordId,
  record: Record<string, unknown>,
  options: { updatePredicate?: SQL } = {},
): Promise<Record<string, unknown>> {
  const pkCol = findPkColumn(schema);
  const pkPredicate = eq(pkCol, id);
  const wherePredicate = options.updatePredicate
    ? and(pkPredicate, options.updatePredicate)!
    : pkPredicate;

  const result = await db
    .update(schema.drizzle)
    .set(resolveRowFields(schema, Object.keys(record)).toDatabaseValues(record))
    .where(wherePredicate)
    .returning();

  if (result.length === 0) {
    throw new Error(`Record with id ${id} not found`);
  }

  return allRowFields(schema).pick(result[0] as Record<string, unknown>);
}

/**
 * Parse and persist one prepared insert or patch.
 *
 * An `id` selects patch semantics and scopes the update to that row. An absent
 * `id` selects insert semantics, including required-field and default rules.
 * The function accepts trusted prepared values as ordinary records; no public
 * "prepared insert" type or lifecycle is required.
 */
export async function savePipeline(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
  id?: RecordId,
  options: { updatePredicate?: SQL } = {},
): Promise<Record<string, unknown>> {
  const parsed = parseForSave(schema, record, id);

  if (id != null) {
    return updateRow(schema, db, id, parsed, options);
  } else {
    return insertRow(schema, db, parsed);
  }
}

export function savePipelineInsertSync(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = parseForSave(schema, record);
  return insertRowSync(schema, db, parsed);
}

function parseForSave(
  schema: TableDef,
  record: Record<string, unknown>,
  id?: RecordId,
): Record<string, unknown> {
  const result = parseTableWrite(
    schema,
    record,
    id != null ? "patch" : "insert",
  );
  if (!result.success) throw new ValidationError(result.issues);
  return result.data;
}

function allRowFields(schema: TableDef) {
  return resolveRowFields(
    schema,
    getTableConfig(schema.drizzle).columns.map((column) => column.name),
  );
}
