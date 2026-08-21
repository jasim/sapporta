import type { ErrorCodeValue } from "../errors.js";

/**
 * Map of `OperationError` / `OperationResult` failure codes to HTTP
 * statuses. Used by the framework's `onError` handler to translate
 * domain errors into status codes and by meta handlers that surface
 * `OperationResult` returns.
 *
 * Keys are constrained to the `ErrorCode` vocabulary in errors.ts. The
 * CLI-only codes (INIT_*, APP_SERVER_UNREACHABLE) are intentionally
 * absent — codes without an entry map to 500 in `statusForCode`.
 */
export const ERROR_CODE_STATUS: Partial<Record<ErrorCodeValue, number>> = {
  TABLE_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_TABLE_NAME: 400,
  INVALID_COLUMN_NAME: 400,
  INVALID_JSON: 400,
  INVALID_SQL: 400,
  DANGEROUS_SQL: 400,
  BAD_LIMIT: 400,
  SELECT_ONLY: 400,
  CONFLICT: 409,
  ROW_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  MISSING_ARGUMENT: 400,
  INTERNAL: 500,
};
