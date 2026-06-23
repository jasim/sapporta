// ---------------------------------------------------------------------------
// Operation result envelope — the contract between domain operations and
// the layers that consume them (API routes, CLI output).
//
// These types were originally in cli-utils.ts as CliResult/CliError but have
// nothing to do with the CLI — they're a structured result pattern used by
// database introspection functions, SQL proxy, and other operations.
// ---------------------------------------------------------------------------

/**
 * Every operation returns an OperationResult instead of printing directly.
 * This separates data production from presentation, enabling:
 *   - HTTP API responses (meta-api.ts converts to JSON + status codes)
 *   - CLI output formatting (emitResult converts to table or JSON)
 *   - Tests that assert on data, not console output
 */
export type OperationResult = OperationSuccess | OperationFailure;

/**
 * Well-known metadata fields used by the output layer for rendering.
 * These fields are the contract between operation functions and consumers:
 *   - message: displayed before the data table (or as the sole output if tableOutputHandled)
 *   - tableOutputHandled: signals that message/additionalOutput contain the full rendering,
 *     so the output layer should NOT format data[] as a table
 *   - additionalOutput: extra text sections printed after the main table
 *   - errorText: printed to stderr (e.g. warnings from report execution)
 *   - rowCount, dryRun: informational fields for agents consuming JSON output
 *
 * The index signature allows operation-specific extras (e.g. foreignKeys, reportData).
 */
export type OperationMeta = {
  message?: string;
  tableOutputHandled?: boolean;
  additionalOutput?: string;
  errorText?: string;
  rowCount?: number;
  dryRun?: boolean;
  [key: string]: unknown;
};

export type OperationSuccess = {
  ok: true;
  /** Primary result rows. Most operations return a single table of rows. */
  data: Record<string, unknown>[];
  /** Optional metadata (row counts, messages, secondary data like foreign keys). */
  meta?: OperationMeta;
};

export type OperationFailure = {
  ok: false;
  error: string;
  code: string;
};

/**
 * Well-known error codes for structured error output.
 * Agents can match on these programmatically instead of parsing error messages.
 */
export const ErrorCode = {
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  INVALID_TABLE_NAME: "INVALID_TABLE_NAME",
  INVALID_COLUMN_NAME: "INVALID_COLUMN_NAME",
  INVALID_JSON: "INVALID_JSON",
  DANGEROUS_SQL: "DANGEROUS_SQL",
  SELECT_ONLY: "SELECT_ONLY",
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

/**
 * SQL client interface matching the subset of postgres.js used by operations.
 * In production, a real postgres.js client is passed.
 * In tests, a PGlite adapter is injected.
 */
export interface SqlClient {
  unsafe: (query: string, params?: any[]) => Promise<any[]>;
  begin: (fn: (sql: SqlClient) => Promise<any>) => Promise<any>;
  end: () => Promise<void>;
}
