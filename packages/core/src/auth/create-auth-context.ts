import type { TableCatalog } from "../schema/catalog.js";
import type { SapportaAuthContext } from "./context.js";
import type { Principal, WorkspaceMembership } from "./principal.js";
import { createRowSecurity } from "./row-security.js";
import type { RowsAllowedForRequest } from "./rows-allowed-for-request.js";

export interface CreateAuthContextInput<
  AppAbility,
  Membership extends WorkspaceMembership = WorkspaceMembership,
> {
  principal: Principal<Membership>;
  rowsAllowedForRequest: RowsAllowedForRequest;
  ability: AppAbility;
  catalog: TableCatalog;
}

/**
 * Creates the final auth value for a request.
 *
 * The caller supplies already-resolved principal, row facts, and ability. The
 * catalog is consumed here only to bind `rowSecurity`; it is not another
 * authorization input that route code should inspect.
 */
export function createAuthContext<
  AppAbility,
  Membership extends WorkspaceMembership = WorkspaceMembership,
>(
  input: CreateAuthContextInput<AppAbility, Membership>,
): SapportaAuthContext<AppAbility, Membership> {
  return {
    principal: input.principal,
    rowsAllowedForRequest: input.rowsAllowedForRequest,
    ability: input.ability,
    rowSecurity: createRowSecurity(input.rowsAllowedForRequest, {
      catalog: input.catalog,
    }),
  };
}
