/**
 * Map of `OperationError` / `OperationResult` failure codes to HTTP
 * statuses. Used by the framework's `onError` handler to translate
 * domain errors into status codes and by meta handlers that surface
 * `OperationResult` returns.
 */
export const ERROR_CODE_STATUS: Record<string, number> = {
  TABLE_NOT_FOUND: 404,
  INVALID_TABLE_NAME: 400,
  INVALID_COLUMN_NAME: 400,
  INVALID_JSON: 400,
  DANGEROUS_SQL: 400,
  SELECT_ONLY: 400,
  PROJECT_NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  MISSING_ARGUMENT: 400,
  INTERNAL: 500,
};
