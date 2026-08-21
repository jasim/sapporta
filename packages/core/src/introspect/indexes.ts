// ============================================================================
// SQLite Index Listing — index metadata via PRAGMA index_list / index_info
// ============================================================================
//
// Uses two PRAGMAs:
//   - index_list("table") → list of indexes with uniqueness flag and origin
//   - index_info("index")  → columns in each index

import type Database from "better-sqlite3";
import type { OperationResult } from "./operation-result.js";
import { assertTableExists } from "./db-helpers.js";
import { validateTableName } from "./sql-safety.js";

/** Row from PRAGMA index_list("tableName") */
interface PragmaIndexList {
  seq: number;
  name: string;
  unique: number; // 0 or 1
  origin: string; // "c" = CREATE INDEX, "u" = UNIQUE constraint, "pk" = PRIMARY KEY
  partial: number; // 0 or 1
}

/** Row from PRAGMA index_info("indexName") */
interface PragmaIndexInfo {
  seqno: number;
  cid: number;
  name: string;
}

export interface IndexDescription {
  name: string;
  unique: boolean;
  columns: string[];
  origin: string;
}

/**
 * List all indexes on a table.
 *
 * For each index, queries PRAGMA index_info to resolve column names.
 * The origin field indicates how the index was created:
 *   "c" = explicit CREATE INDEX
 *   "u" = UNIQUE constraint in CREATE TABLE
 *   "pk" = PRIMARY KEY constraint
 */
export function describeIndexes(
  sqlite: Database.Database,
  tableName: string,
): IndexDescription[] {
  validateTableName(tableName);
  assertTableExists(sqlite, tableName);

  const indexes = sqlite.pragma(
    `index_list("${tableName}")`,
  ) as PragmaIndexList[];

  return indexes.map((idx) => {
    const cols = sqlite.pragma(
      `index_info("${idx.name}")`,
    ) as PragmaIndexInfo[];
    return {
      name: idx.name,
      unique: idx.unique === 1,
      columns: cols.map((c) => c.name),
      origin: idx.origin,
    };
  });
}

/**
 * OperationResult wrapper for CLI/API consumption.
 */
export function dbIndexes(
  sqlite: Database.Database,
  tableName: string,
): OperationResult {
  const indexes = describeIndexes(sqlite, tableName);

  if (indexes.length === 0) {
    return {
      ok: true,
      data: [],
      meta: { message: `No indexes found for table '${tableName}'.` },
    };
  }

  // Flatten to match the output shape for CLI table rendering
  const data = indexes.map((idx) => ({
    index_name: idx.name,
    columns: idx.columns.join(", "),
    is_unique: idx.unique,
    is_primary: idx.origin === "pk",
  }));

  return {
    ok: true,
    data,
    meta: { message: `Indexes on ${tableName}:` },
  };
}
