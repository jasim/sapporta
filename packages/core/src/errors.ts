// ---------------------------------------------------------------------------
// The error vocabulary of @sapporta/server, published as the ./errors module.
//
// Machine-readable error codes, the code-carrying error classes thrown by
// operations and the save pipeline, and SQLite error classification. The
// HTTP status mapping for these codes is an API-layer concern and lives in
// api/error-codes.ts; the OperationResult envelope that failure codes
// travel in lives in introspect/operation-result.ts.
// ---------------------------------------------------------------------------

/**
 * Well-known error codes for structured error output.
 * Agents can match on these programmatically instead of parsing error messages.
 */
export const ErrorCode = {
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TABLE_NAME: "INVALID_TABLE_NAME",
  INVALID_COLUMN_NAME: "INVALID_COLUMN_NAME",
  INVALID_JSON: "INVALID_JSON",
  INVALID_SQL: "INVALID_SQL",
  DANGEROUS_SQL: "DANGEROUS_SQL",
  BAD_LIMIT: "BAD_LIMIT",
  SELECT_ONLY: "SELECT_ONLY",
  CONFLICT: "CONFLICT",
  ROW_NOT_FOUND: "ROW_NOT_FOUND",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  REPORT_NOT_FOUND: "REPORT_NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  MISSING_ARGUMENT: "MISSING_ARGUMENT",
  INIT_NPM_REGISTRY_UNAVAILABLE: "INIT_NPM_REGISTRY_UNAVAILABLE",
  INIT_SETUP_FAILED: "INIT_SETUP_FAILED",
  INIT_TARGET_EXISTS: "INIT_TARGET_EXISTS",
  APP_SERVER_UNREACHABLE: "APP_SERVER_UNREACHABLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Typed error that carries a machine-readable error code.
 * Operations throw these; consumers catch and convert to appropriate output.
 */
export class OperationError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

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

/** Closed taxonomy of generated table-query parse failures. Every code maps
 *  to HTTP 400 at the table handler — silent-ignore is rejected as a class,
 *  so typos and malformed query strings surface as client errors rather than
 *  returning broader results. */
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
