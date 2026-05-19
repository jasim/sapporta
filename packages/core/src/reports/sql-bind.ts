// ============================================================================
// SQL BIND VARIABLES
// ============================================================================
//
// A SQL query in Sapporta uses $name syntax for bind variables. This module
// provides the operations for working with those variables:
//
//   scan     — walk SQL respecting strings/comments, call back for each $name
//   extract  — discover which bind variable names appear in a query
//   buildPositional — convert $name → ?,?,... for SQLite execution
//
// The scanner is the shared primitive. extract and buildPositional are both
// built on top of it.

// ---------------------------------------------------------------------------
// Scanner — the shared primitive
// ---------------------------------------------------------------------------

/**
 * Walk a SQL string respecting single-quoted strings, line comments (--),
 * and block comments. Calls onBind(name) for each $name bind variable found;
 * the callback's return value replaces `$name` in the output.
 * Returns the rebuilt SQL string.
 */
export function scanSqlBindVariables(
  sql: string,
  onBind: (name: string) => string,
): string {
  let result = "";
  let i = 0;

  while (i < sql.length) {
    // Single-quoted string — copy verbatim, handling '' escapes
    if (sql[i] === "'") {
      result += "'";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          result += "''";
          i += 2;
        } else if (sql[i] === "'") {
          break;
        } else {
          result += sql[i];
          i++;
        }
      }
      if (i < sql.length) {
        result += "'";
        i++; // closing quote
      }
      continue;
    }

    // -- line comment — copy verbatim
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        result += sql[i];
        i++;
      }
      continue;
    }

    // /* block comment */ — copy verbatim
    if (sql[i] === "/" && sql[i + 1] === "*") {
      result += "/*";
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) {
        result += sql[i];
        i++;
      }
      if (i < sql.length - 1) {
        result += "*/";
        i += 2;
      }
      continue;
    }

    // $name bind variable (not $1 positional params)
    if (sql[i] === "$" && i + 1 < sql.length && /[a-zA-Z_]/.test(sql[i + 1])) {
      let name = "";
      i++; // skip $
      while (i < sql.length && /[a-zA-Z0-9_]/.test(sql[i])) {
        name += sql[i];
        i++;
      }
      result += onBind(name);
      continue;
    }

    result += sql[i];
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extract — discover bind variable names
// ---------------------------------------------------------------------------

/**
 * Extract $name bind variable references from a SQL string.
 * Skips strings (single-quoted) and comments (-- and /* ... *​/).
 * Returns variable names in order of first appearance (no duplicates).
 */
export function extractBindVariables(sql: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  scanSqlBindVariables(sql, (name) => {
    if (!seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
    return `$${name}`;
  });
  return vars;
}

// ---------------------------------------------------------------------------
// Build positional — convert $name to ? for SQLite
// ---------------------------------------------------------------------------

/**
 * Convert $name bind variables to ? positional parameters for SQLite.
 *
 * Each occurrence of $name becomes a separate ? in the output SQL,
 * with the corresponding value appended to the values array. If the
 * same $name appears multiple times, the value is duplicated — SQLite's
 * ? parameters are strictly positional with no reuse mechanism (unlike
 * Postgres's $N which allows same-position reuse).
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
export function buildPositionalQuery(
  sql: string,
  _bindVars: string[],
  values: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const orderedValues: unknown[] = [];

  // Replace every $name with ?, appending the value for each occurrence.
  // SQLite's ? params are consumed in order — no way to reference by
  // position number like Postgres's $N.
  const result = scanSqlBindVariables(sql, (name) => {
    orderedValues.push(values[name] ?? null);
    return "?";
  });

  return { sql: result, values: orderedValues };
}
