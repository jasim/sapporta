import { z } from "zod";
import type { SqlClient, OperationResult } from "../introspect/types.js";
import { rejectDangerousSQL } from "../introspect/sql-safety.js";
import { buildInsertQuery, validatePayloadColumns } from "../introspect/db-helpers.js";
import { validateTableName, validateColumnNames, rejectControlChars } from "../introspect/sql-safety.js";

export const rowsInsertInput = z.object({
  table: z.string().describe("Target table name"),
  data: z.string().describe("JSON string: single object or array of objects"),
  dryRun: z.boolean().optional().describe("Validate without executing"),
});

/**
 * Insert one or more rows into a table.
 * Data is provided as a JSON string (single object or array of objects).
 * Returns the inserted rows (via RETURNING *).
 *
 * When dryRun is true, validates everything (table exists, columns exist,
 * types are compatible) without executing the insert.
 */
export async function rowsInsert(
  sql: SqlClient,
  tableName: string,
  dataJson: string,
  dryRun: boolean = false,
): Promise<OperationResult> {
  // Validate table name (delegates to shared identifier check in cli-utils)
  validateTableName(tableName);

  // Reject control characters before parsing -- agents sometimes produce
  // invisible chars that would silently corrupt data in the database.
  rejectControlChars(dataJson);

  const data = JSON.parse(dataJson);
  const rows = Array.isArray(data) ? data : [data];

  if (rows.length === 0) {
    return { ok: true, data: [], meta: { message: "No data to insert." } };
  }

  // Validate all column names upfront
  for (const row of rows) {
    validateColumnNames(Object.keys(row));
  }

  if (dryRun) {
    return dryRunValidation(sql, tableName, rows);
  }

  const results: any[] = [];
  for (const row of rows) {
    const { query, values } = buildInsertQuery(tableName, row);
    rejectDangerousSQL(query);
    const inserted = await sql.unsafe(query, values);
    results.push(...inserted);
  }

  return {
    ok: true,
    data: results,
    meta: {
      message: `Inserted ${results.length} row(s) into ${tableName}:`,
      rowCount: results.length,
      tableName,
    },
  };
}

/**
 * Dry-run validation: checks that the table exists and all columns
 * in the payload exist in the target table. Does NOT execute the insert.
 *
 * Delegates to shared primitives (assertTableExists, getTableColumns)
 * via validatePayloadColumns in cli-utils.ts.
 */
async function dryRunValidation(
  sql: SqlClient,
  tableName: string,
  rows: Record<string, unknown>[],
): Promise<OperationResult> {
  // Collect all unique column names across all rows, then validate them
  // against the actual table schema in one call.
  const allPayloadColumns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  await validatePayloadColumns(sql as any, tableName, allPayloadColumns);

  return {
    ok: true,
    data: rows as Record<string, unknown>[],
    meta: {
      message: `Dry run: ${rows.length} row(s) would be inserted into ${tableName}`,
      dryRun: true,
      tableName,
      rowCount: rows.length,
      validationPassed: true,
    },
  };
}
