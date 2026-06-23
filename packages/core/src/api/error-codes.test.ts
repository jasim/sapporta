/**
 * `ERROR_CODE_STATUS` is the single source of truth for mapping
 * `OperationError`/`OperationResult` codes to HTTP statuses in the default
 * error handler and meta handlers. A verbatim snapshot here catches
 * accidental deletions during refactors — `server.test.ts` covers one code
 * end-to-end but won't notice if another code silently drops out of the map.
 */
import { describe, it, expect } from "vitest";
import { ERROR_CODE_STATUS } from "./error-codes.js";

describe("ERROR_CODE_STATUS", () => {
  it("matches the canonical map verbatim", () => {
      expect(ERROR_CODE_STATUS).toEqual({
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
    });
  });
});
