import type { TableDef } from "../schema/table.js";
import {
  authorityNames,
  type RequestDataAuthority,
} from "./request-data-authority.js";

/**
 * Raised when a request's data authority cannot support the target table scope.
 *
 * This is a forbidden request, not a broken schema. For example, anonymous
 * system-only row access is valid, but it must fail closed when a handler tries
 * to read a workspace table.
 */
export class RowScopePolicyError extends Error {
  readonly status = 403;
  readonly code = "row_scope_forbidden";

  constructor(table: TableDef, dataAuthority: RequestDataAuthority) {
    super(
      `Request data authority [${authorityNames(dataAuthority).join(", ")}] cannot access "${table.sqlName}" ${String(table.meta.rowScope)} rows.`,
    );
    this.name = "RowScopePolicyError";
  }
}
