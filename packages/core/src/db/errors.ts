import { ErrorCode, type ErrorCodeValue } from "../introspect/types.js";

export class ValidationError extends Error {
  public readonly errors: Array<{ field: string; message: string }>;

  constructor(errors: Array<{ field: string; message: string }>) {
    const msg = errors.map((e) => `${e.field}: ${e.message}`).join(", ");
    super(`Validation failed: ${msg}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class ActionError extends Error {
  public readonly code: string;

  constructor(message: string, code = "ACTION_ERROR") {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

export type ClassifiedSqliteError = {
  code: ErrorCodeValue;
  status: 400 | 409 | 422 | 500;
  message: string;
};

export type SqliteErrorContext = "sql" | "write" | "framework";

export function classifySqliteError(
  err: unknown,
  context: SqliteErrorContext,
): ClassifiedSqliteError | null {
  const sqliteError = readSqliteError(err);
  if (!sqliteError) return null;

  if (sqliteError.code.startsWith("SQLITE_CONSTRAINT")) {
    if (isUniqueConstraint(sqliteError)) {
      return {
        code: ErrorCode.CONFLICT,
        status: 409,
        message: "Record conflicts with an existing value.",
      };
    }
    return {
      code: ErrorCode.VALIDATION_FAILED,
      status: 422,
      message: sqliteError.message,
    };
  }

  if (context === "sql" && isInvalidSqliteSql(sqliteError.code)) {
    return {
      code: ErrorCode.INVALID_SQL,
      status: 400,
      message: sqliteError.message,
    };
  }

  return {
    code: ErrorCode.INTERNAL,
    status: 500,
    message: sqliteError.message,
  };
}

function readSqliteError(
  err: unknown,
): { code: string; message: string } | null {
  if (!(err instanceof Error)) return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string" || !code.startsWith("SQLITE_")) return null;
  return { code, message: err.message };
}

function isUniqueConstraint(err: { code: string; message: string }): boolean {
  return (
    err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    err.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    err.message.includes("UNIQUE constraint failed") ||
    err.message.includes("PRIMARY KEY constraint failed")
  );
}

function isInvalidSqliteSql(code: string): boolean {
  return code === "SQLITE_ERROR" || code === "SQLITE_RANGE";
}

/** Closed taxonomy of parseQuery() failures. Every code maps to HTTP 400 at
 *  the table handler — silent-ignore is rejected as a class, so typos and
 *  malformed query strings surface as client errors rather than returning
 *  "all rows". */
export type QueryParseErrorCode =
  | "unknown_filter_shape"
  | "unknown_column"
  | "unknown_op"
  | "bad_value"
  | "op_not_applicable"
  | "bad_limit"
  | "bad_page"
  | "no_search_config";

export class QueryParseError extends Error {
  public readonly code: QueryParseErrorCode;

  constructor(code: QueryParseErrorCode, message: string) {
    super(message);
    this.name = "QueryParseError";
    this.code = code;
  }
}
