import { and, eq, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { TableDef } from "../schema/table.js";
import type { RowId } from "@sapporta/shared/row-id";
import { findPkColumn } from "../schema/pk.js";
import { validate } from "./validate.js";
import { ValidationError } from "../db/errors.js";
import { rejectControlChars } from "./sanitize.js";

/**
 * Insert a new row using Drizzle's table API.
 */
export async function insertRow(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await db
    .insert(schema.drizzle)
    .values(record as any)
    .returning();

  return result[0] as Record<string, unknown>;
}

/**
 * Update an existing row using Drizzle's table API.
 */
export async function updateRow(
  schema: TableDef,
  db: BetterSQLite3Database,
  id: RowId,
  record: Record<string, unknown>,
  options: { updatePredicate?: SQL } = {},
): Promise<Record<string, unknown>> {
  const pkCol = findPkColumn(schema);
  const drizzleCol = (schema.drizzle as any)[pkCol.name];
  const pkPredicate = eq(drizzleCol, id);
  const wherePredicate = options.updatePredicate
    ? and(pkPredicate, options.updatePredicate)!
    : pkPredicate;

  const result = await db
    .update(schema.drizzle)
    .set(record as any)
    .where(wherePredicate)
    .returning();

  if (result.length === 0) {
    throw new Error(`Record with id ${id} not found`);
  }

  return result[0] as Record<string, unknown>;
}

/**
 * The save pipeline: validate -> insert or update.
 * If `id` is provided, it updates; otherwise it inserts.
 */
export async function savePipeline(
  schema: TableDef,
  db: BetterSQLite3Database,
  record: Record<string, unknown>,
  id?: RowId,
  options: { updatePredicate?: SQL } = {},
): Promise<Record<string, unknown>> {
  // Step 0: Reject control characters in string values
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      try {
        rejectControlChars(value);
      } catch {
        throw new ValidationError([
          { field: key, message: "Value contains control characters" },
        ]);
      }
    }
  }

  // Step 1: Validate (partial for updates — only submitted fields are checked)
  const errors = validate(schema, record, id != null ? { partial: true } : undefined);
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  // Step 2: Insert or update
  if (id != null) {
    return updateRow(schema, db, id, record, options);
  } else {
    return insertRow(schema, db, record);
  }
}
