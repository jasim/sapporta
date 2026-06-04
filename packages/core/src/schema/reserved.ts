/**
 * Reserved identifiers that cannot be used as table names.
 * These collide with static route segments mounted before dynamic table routes.
 */
const RESERVED_TABLE_NAMES = new Set([
  // Static API route segments
  "_schema",
  "_meta",
  "_reports",
  "_forms",
  "actions",
  // Per-table sub-path segments (used in /:tableName/_lookup etc.)
  "_lookup",
  "_count",
]);

/**
 * Reserved prefixes. Any name starting with these is rejected.
 */
const RESERVED_PREFIXES = ["_sapporta_"];

/**
 * Validate a SQL table name for use as a UI-managed table.
 *
 * Rules:
 * - Must match [a-z][a-z0-9_]* (snake_case, starts with letter)
 * - Must not be a reserved route segment
 * - Must not start with a reserved prefix
 * - Must not be a SQLite reserved keyword
 */
export function validateTableName(
  name: string,
): { valid: true } | { valid: false; reason: string } {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return {
      valid: false,
      reason: "Must be lowercase snake_case starting with a letter",
    };
  }
  if (RESERVED_TABLE_NAMES.has(name)) {
    return { valid: false, reason: `"${name}" is a reserved system name` };
  }
  for (const prefix of RESERVED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return {
        valid: false,
        reason: `Names starting with "${prefix}" are reserved for internal use`,
      };
    }
  }
  if (SQLITE_RESERVED_WORDS.has(name)) {
    return { valid: false, reason: `"${name}" is a SQLite reserved word` };
  }
  return { valid: true };
}

/**
 * Validate a SQL column name.
 */
export function validateColumnName(
  name: string,
): { valid: true } | { valid: false; reason: string } {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return {
      valid: false,
      reason: "Must be lowercase snake_case starting with a letter",
    };
  }
  if (name === "id" || name === "created_at" || name === "updated_at") {
    return {
      valid: false,
      reason: `"${name}" is auto-managed and cannot be added manually`,
    };
  }
  return { valid: true };
}

/** SQLite reserved keywords from https://www.sqlite.org/lang_keywords.html */
const SQLITE_RESERVED_WORDS = new Set([
  "abort",
  "action",
  "add",
  "after",
  "all",
  "alter",
  "always",
  "analyze",
  "and",
  "as",
  "asc",
  "attach",
  "autoincrement",
  "before",
  "begin",
  "between",
  "by",
  "cascade",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "commit",
  "conflict",
  "constraint",
  "create",
  "cross",
  "current",
  "current_date",
  "current_time",
  "current_timestamp",
  "database",
  "default",
  "deferrable",
  "deferred",
  "delete",
  "desc",
  "detach",
  "distinct",
  "do",
  "drop",
  "each",
  "else",
  "end",
  "escape",
  "except",
  "exclude",
  "exclusive",
  "exists",
  "explain",
  "fail",
  "filter",
  "first",
  "following",
  "for",
  "foreign",
  "from",
  "full",
  "generated",
  "glob",
  "group",
  "groups",
  "having",
  "if",
  "ignore",
  "immediate",
  "in",
  "index",
  "indexed",
  "initially",
  "inner",
  "insert",
  "instead",
  "intersect",
  "into",
  "is",
  "isnull",
  "join",
  "key",
  "last",
  "left",
  "like",
  "limit",
  "match",
  "materialized",
  "natural",
  "no",
  "not",
  "nothing",
  "notnull",
  "null",
  "nulls",
  "of",
  "offset",
  "on",
  "or",
  "order",
  "others",
  "outer",
  "over",
  "partition",
  "plan",
  "pragma",
  "preceding",
  "primary",
  "query",
  "raise",
  "range",
  "recursive",
  "references",
  "regexp",
  "reindex",
  "release",
  "rename",
  "replace",
  "restrict",
  "returning",
  "right",
  "rollback",
  "row",
  "rows",
  "savepoint",
  "select",
  "set",
  "table",
  "temp",
  "temporary",
  "then",
  "ties",
  "to",
  "transaction",
  "trigger",
  "unbounded",
  "union",
  "unique",
  "update",
  "using",
  "vacuum",
  "values",
  "view",
  "virtual",
  "when",
  "where",
  "window",
  "with",
  "without",
]);
