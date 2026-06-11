import type { RowSecurity } from "./row-security.js";
import type { SapportaAbility } from "./ability.js";
import type { Principal, WorkspaceMembership } from "./principal.js";
import type { RequestDataAuthority } from "./request-data-authority.js";

/**
 * The authorization facts available to one request.
 *
 * Read this as four separate questions:
 * - who is asking (`principal`);
 * - which trusted ownership facts may database helpers use (`dataAuthority`);
 * - what actions may the requester perform (`ability`);
 * - how those ownership facts become SQL predicates and trusted insert values
 *   (`rowSecurity`).
 *
 * Keeping those questions separate is the main invariant. A CASL permission can
 * allow an action without widening row predicates, and anonymous public routes
 * can use row security without pretending to be signed-in users.
 */
export interface SapportaAuthContext<
  AppAbility = SapportaAbility,
  Membership extends WorkspaceMembership = WorkspaceMembership,
> {
  principal: Principal<Membership>;
  dataAuthority: RequestDataAuthority;
  ability: AppAbility;
  rowSecurity: RowSecurity;
}
