// ============================================================================
// SQLite Describe All — batch table description
// ============================================================================
//
// Calls describeTable() for each table from listTables().
// No new PRAGMA patterns — just composition of existing primitives.

import type Database from "better-sqlite3";
import type { OperationResult } from "./operation-result.js";
import { listTables } from "./list-tables.js";
import { describeTable, type TableDescription } from "./describe.js";

/**
 * Describe all user tables in the database.
 * Returns an array of TableDescription objects in alphabetical order.
 */
export function describeAllTables(
  sqlite: Database.Database,
): TableDescription[] {
  const tables = listTables(sqlite);
  return tables.map((t) => describeTable(sqlite, t.name));
}

/**
 * OperationResult wrapper for CLI/API consumption.
 *
 * Returns flat column array as primary data (for table-mode rendering)
 * and structured per-table objects in meta (for JSON consumers).
 */
export function dbDescribeAll(sqlite: Database.Database): OperationResult {
  const descriptions = describeAllTables(sqlite);

  if (descriptions.length === 0) {
    return { ok: true, data: [], meta: { message: "No tables found." } };
  }

  // Flat column array with table_name prefix for table-mode rendering
  const flatData: Record<string, unknown>[] = [];
  for (const desc of descriptions) {
    for (const col of desc.columns) {
      flatData.push({
        table_name: desc.name,
        ...col,
      });
    }
  }

  // Structured per-table format for JSON consumers
  const structured = descriptions.map((desc) => ({
    table_name: desc.name,
    columns: desc.columns,
  }));

  // Text output grouping by table
  const lines: string[] = [];
  for (const desc of descriptions) {
    lines.push(`\n── ${desc.name} ──`);
    for (const col of desc.columns) {
      const flags = [];
      if (col.is_primary_key === "YES") flags.push("PK");
      if (col.is_unique === "YES") flags.push("UNIQUE");
      if (col.is_nullable === "NO") flags.push("NOT NULL");
      if (col.column_default) flags.push(`DEFAULT ${col.column_default}`);
      if (col.foreign_table)
        flags.push(`FK → ${col.foreign_table}.${col.foreign_column}`);
      const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      lines.push(`  ${col.column_name}: ${col.data_type}${flagStr}`);
    }
  }

  return {
    ok: true,
    data: flatData,
    meta: {
      tables: structured,
      textOutput: lines.join("\n"),
      tableOutputHandled: true,
      message: lines.join("\n"),
    },
  };
}
