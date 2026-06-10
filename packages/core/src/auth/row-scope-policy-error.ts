import type { TableDef } from "../schema/table.js";
import type { RowsAllowedForRequest } from "./rows-allowed-for-request.js";

/**
 * Raised when a request's row facts cannot support the target table scope.
 *
 * This is a forbidden request, not a broken schema. For example, anonymous
 * system-only row access is valid, but it must fail closed when a handler tries
 * to read a workspace table.
 */
export class RowScopePolicyError extends Error {
  readonly status = 403;
  readonly code = "row_scope_forbidden";

  constructor(table: TableDef, rowsAllowedForRequest: RowsAllowedForRequest) {
    super(
      `Rows allowed for request "${rowsAllowedForRequest.kind}" cannot access "${table.sqlName}" rows.`,
    );
    this.name = "RowScopePolicyError";
  }
}
