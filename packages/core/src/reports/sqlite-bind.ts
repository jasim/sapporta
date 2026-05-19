// ============================================================================
// SQLite Bind Variable Conversion — $name → ? positional parameters
// ============================================================================
//
// Reuses the dialect-agnostic scanner from sql-bind.ts (scanSqlBindVariables,
// extractBindVariables) which handles string/comment skipping. Only the
// positional parameter format differs between Postgres and SQLite:
//
//   Postgres: $name → $1, $2, ... (reusable — same $1 for duplicate $name)
//   SQLite:   $name → ? (strictly positional — duplicates get separate ?s
//             with the same value repeated in the values array)
//
// This is because SQLite's ? parameters are consumed in order, with no way
// to reference a parameter by position number like Postgres's $N.

import { scanSqlBindVariables } from "./sql-bind.js";

// Re-export the dialect-agnostic utilities — callers of this module
// shouldn't need to import from sql-bind.ts separately
export { extractBindVariables } from "./sql-bind.js";

/**
 * Convert $name bind variables to ? positional parameters for SQLite.
 *
 * Each occurrence of $name becomes a separate ? in the output SQL,
 * with the corresponding value appended to the values array. If the
 * same $name appears multiple times, the value is duplicated — SQLite's
 * ? parameters are strictly positional with no reuse mechanism.
 *
 * Example:
 *   Input:  "SELECT * FROM t WHERE year = $year AND month = $month"
 *   values: { year: 2024, month: 1 }
 *   Output: { sql: "SELECT * FROM t WHERE year = ? AND month = ?",
 *             values: [2024, 1] }
 *
 * Example with duplicate:
 *   Input:  "SELECT * FROM t WHERE start = $year OR end = $year"
 *   values: { year: 2024 }
 *   Output: { sql: "SELECT * FROM t WHERE start = ? OR end = ?",
 *             values: [2024, 2024] }
 */
export function buildSQLitePositionalQuery(
  sql: string,
  _bindVars: string[],
  values: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const orderedValues: unknown[] = [];

  // Replace every $name with ?, appending the value for each occurrence.
  // Unlike Postgres buildPositionalQuery which maps $name → $N (allowing
  // reuse of the same positional param), SQLite requires one ? per value.
  const processedSql = scanSqlBindVariables(sql, (name) => {
    orderedValues.push(values[name] ?? null);
    return "?";
  });

  return { sql: processedSql, values: orderedValues };
}
