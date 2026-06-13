// ============================================================================
// Database-agnostic column type normalization
// ============================================================================
//
// Drizzle's internal columnType and dataType strings differ between
// Postgres and SQLite:
//
//   Postgres:
//     PgTimestampString  → dataType "string"  (mode: "string")
//     PgTimestamp         → dataType "date"    (default mode, returns Date objects)
//     PgDateString        → dataType "string"
//     PgDate              → dataType "string"
//     PgNumeric           → dataType "string"  (Postgres NUMERICs are strings in JS)
//     PgBoolean           → dataType "boolean"
//
//   SQLite:
//     SQLiteText          → dataType "string"
//     SQLiteInteger       → dataType "number"
//     SQLiteReal          → dataType "number"
//     SQLiteBoolean       → dataType "boolean" (mode: "boolean")
//     SQLiteTimestamp     → dataType "date"    (mode: "timestamp", returns Date objects)
//
// The UI needs stable, dialect-agnostic dataType values for formatting.
// This module provides the single point of truth for that normalization.
//
// The current callers that do ad-hoc columnType checks:
//   - extract.ts: PgDateString, PgDate, PgTimestampString → "date"
//   - check.ts: PgTimestamp for Date-object-mode warning
//   - validate.ts: PgTimestampString recognition
//
// This module centralizes those checks and extends them to SQLite types.

/**
 * Drizzle columnType values that represent date/timestamp columns.
 *
 * These are the columnType strings where the UI should use "date" formatting
 * regardless of what Drizzle reports as dataType. The set covers:
 *   - Postgres timestamp/date columns in string mode (dataType = "string")
 *   - Postgres timestamp in Date mode (dataType = "date", but we normalize anyway)
 *   - SQLite timestamp (already dataType = "date" via mode: "timestamp")
 */
const DATE_COLUMN_TYPES = new Set([
  // Postgres — string-mode timestamps report dataType "string" in Drizzle,
  // but the UI needs "date" for display formatting. See timestamp() in table.ts.
  "PgDateString",
  "PgDate",
  "PgTimestampString",
  "PgTimestamp",
  // SQLite — already returns dataType "date", but included for completeness
  "SQLiteTimestamp",
]);

/**
 * Derive a stable, UI-facing dataType from Drizzle's column metadata.
 *
 * Priority order:
 * 1. Known date/timestamp columnTypes (dialect-specific but harmless to check both)
 * 2. Fall through to Drizzle's own dataType (works for most types)
 *
 * The returned string is one of: "string", "number", "boolean", "date"
 * These map directly to UI formatting strategies.
 */
export function normalizeDataType(col: {
  columnType: string;
  dataType: string;
}): string {
  // Known date/timestamp types — overrides Drizzle's dataType which may be
  // "string" for string-mode Pg timestamps, or already "date" for others
  if (DATE_COLUMN_TYPES.has(col.columnType)) return "date";

  // Fall through to Drizzle's reported dataType.
  // This handles: "string", "number", "boolean", "date" (SQLiteTimestamp, PgTimestamp)
  return col.dataType;
}

/**
 * Detect if a column uses Date-object mode (not string mode).
 *
 * Used by schema checking to warn about non-JSON-safe timestamp modes.
 * Sapporta is a JSON-over-HTTP framework — Date objects don't serialize
 * cleanly across HTTP boundaries. The mode: "string" timestamp helper
 * (table.ts) exists to avoid this, so finding Date-mode columns is a
 * schema error that should be flagged.
 *
 * Date-object mode columns:
 *   Postgres: PgTimestamp (default mode) returns Date objects
 *   SQLite:   SQLiteTimestamp (mode: "timestamp") returns Date objects
 */
export function isDateObjectMode(col: { columnType: string }): boolean {
  // PgTimestamp is the default-mode Postgres timestamp — returns Date objects.
  // PgTimestampString is the string-mode variant — returns ISO strings (safe).
  if (col.columnType === "PgTimestamp") return true;
  // SQLiteTimestamp with mode: "timestamp" returns Date objects.
  // (SQLite stores as integer epoch, Drizzle converts to Date on read.)
  if (col.columnType === "SQLiteTimestamp") return true;
  return false;
}
