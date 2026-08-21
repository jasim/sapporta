// ============================================================================
// SQLite Table Description — column metadata via PRAGMA table_info
// ============================================================================
//
// Split into a pure transformer (buildColumnDescriptions) and a thin I/O
// wrapper (describeTable). The pure function can be tested with mock
// PRAGMA output, without touching any database.
//
// SQLite's PRAGMA table_info returns a fundamentally different shape than
// PostgreSQL's information_schema. Key differences:
//   - Types are affinity-based (TEXT, INTEGER, REAL, BLOB, NUMERIC),
//     not rich types (varchar(255), timestamptz, etc.)
//   - Primary key is indicated by pk > 0, not a separate constraint query
//   - Foreign keys require a separate PRAGMA foreign_key_list() call
//   - No UNIQUE information from table_info (requires index_list + index_info)

import type Database from "better-sqlite3";
import type { OperationResult } from "./operation-result.js";

// ─── Raw PRAGMA result types ────────────────────────────────────────────────

/** Row from PRAGMA table_info("tableName") */
export interface PragmaTableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number; // 0 or 1
  dflt_value: string | null;
  pk: number; // 0 = not PK, >0 = PK ordinal position
}

/** Row from PRAGMA foreign_key_list("tableName") */
export interface PragmaForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

// ─── Output types ───────────────────────────────────────────────────────────

export interface ColumnDescription {
  column_name: string;
  data_type: string;
  is_nullable: string; // "YES" | "NO" — matches Postgres information_schema convention
  column_default: string | null;
  is_primary_key: string; // "YES" | "NO"
  is_unique: string; // "YES" | "NO"
  foreign_table: string | null;
  foreign_column: string | null;
}

export interface TableDescription {
  name: string;
  columns: ColumnDescription[];
}

// ─── Pure transformer ───────────────────────────────────────────────────────

/**
 * Transform raw PRAGMA output into a unified column description format.
 *
 * This is the pure, testable core. It maps SQLite's PRAGMA structures into
 * the same shape used by the old Postgres describe.ts, so the CLI and API
 * layers can consume both uniformly.
 *
 * @param pragmaInfo Rows from PRAGMA table_info()
 * @param pragmaFks  Rows from PRAGMA foreign_key_list()
 * @param uniqueCols Set of column names that have a UNIQUE index (from describeTable)
 */
export function buildColumnDescriptions(
  pragmaInfo: PragmaTableInfo[],
  pragmaFks: PragmaForeignKey[],
  uniqueCols: Set<string> = new Set(),
): ColumnDescription[] {
  // Build FK lookup: source column name → { table, column }
  // A column can only be the source of one FK in practice, but
  // PRAGMA foreign_key_list can return multi-column FKs (seq > 0).
  // We only handle single-column FKs here (seq === 0).
  const fkMap = new Map<string, { table: string; column: string }>();
  for (const fk of pragmaFks) {
    if (fk.seq === 0) {
      fkMap.set(fk.from, { table: fk.table, column: fk.to });
    }
  }

  return pragmaInfo.map((col) => {
    const fk = fkMap.get(col.name);
    return {
      column_name: col.name,
      data_type: col.type || "TEXT", // SQLite allows empty type strings
      is_nullable: col.notnull === 1 ? "NO" : "YES",
      column_default: col.dflt_value,
      is_primary_key: col.pk > 0 ? "YES" : "NO",
      is_unique: uniqueCols.has(col.name) ? "YES" : "NO",
      foreign_table: fk?.table ?? null,
      foreign_column: fk?.column ?? null,
    };
  });
}

// ─── I/O wrapper ────────────────────────────────────────────────────────────

/**
 * Describe a table's structure by querying SQLite PRAGMAs.
 *
 * Gathers column info, foreign keys, and unique constraints from three
 * separate PRAGMAs and merges them via buildColumnDescriptions.
 */
export function describeTable(
  sqlite: Database.Database,
  tableName: string,
): TableDescription {
  const info = sqlite.pragma(`table_info("${tableName}")`) as PragmaTableInfo[];
  const fks = sqlite.pragma(
    `foreign_key_list("${tableName}")`,
  ) as PragmaForeignKey[];

  // Determine which columns have UNIQUE indexes.
  // PRAGMA index_list returns all indexes; we filter for unique ones,
  // then check index_info for single-column indexes to mark them.
  const uniqueCols = new Set<string>();
  const indexes = sqlite.pragma(`index_list("${tableName}")`) as {
    name: string;
    unique: number;
  }[];
  for (const idx of indexes) {
    if (idx.unique === 1) {
      const cols = sqlite.pragma(`index_info("${idx.name}")`) as {
        name: string;
      }[];
      // Only mark single-column unique indexes (multi-column unique
      // constraints are a table-level property, not per-column)
      if (cols.length === 1) {
        uniqueCols.add(cols[0].name);
      }
    }
  }

  return {
    name: tableName,
    columns: buildColumnDescriptions(info, fks, uniqueCols),
  };
}

/**
 * OperationResult wrapper for CLI/API consumption.
 */
export function dbDescribe(
  sqlite: Database.Database,
  tableName: string,
): OperationResult {
  const desc = describeTable(sqlite, tableName);

  if (desc.columns.length === 0) {
    return {
      ok: true,
      data: [],
      meta: { message: `Table '${tableName}' not found.` },
    };
  }

  // Separate FK info for structured output (same pattern as old Postgres version)
  const fkColumns = desc.columns.filter((c) => c.foreign_table !== null);
  const foreignKeys = fkColumns.map((c) => ({
    column_name: c.column_name,
    foreign_table: c.foreign_table,
    foreign_column: c.foreign_column,
  }));

  return {
    ok: true,
    data: desc.columns as unknown as Record<string, unknown>[],
    meta: {
      message: `Table: ${tableName}\n`,
      tableName,
      foreignKeys,
    },
  };
}
