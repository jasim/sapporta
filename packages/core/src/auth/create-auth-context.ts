import type { TableCatalog } from "../schema/catalog.js";
import type { SapportaAuthContext } from "./context.js";
import type { Principal, WorkspaceMembership } from "./principal.js";
import { createRowSecurity } from "./row-security.js";
import type { RequestDataAuthority } from "./request-data-authority.js";

export interface CreateAuthContextInput<
  AppAbility,
  Membership extends WorkspaceMembership = WorkspaceMembership,
> {
  principal: Principal<Membership>;
  dataAuthority: RequestDataAuthority;
  ability: AppAbility;
  catalog: TableCatalog;
}

/**
 * Creates the final auth value for a request.
 *
 * The caller supplies already-resolved principal, data authority, and ability. The
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
    dataAuthority: input.dataAuthority,
    ability: input.ability,
    rowSecurity: createRowSecurity(input.dataAuthority, {
      catalog: input.catalog,
    }),
  };
}
