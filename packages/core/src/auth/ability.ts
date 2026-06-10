import type { Principal, WorkspaceMembership } from "./principal.js";
import type { RowsAllowedForRequest } from "./rows-allowed-for-request.js";

/**
 * Minimal ability protocol Sapporta needs from an application CASL ability.
 *
 * Applications should define their own action/subject vocabulary and concrete
 * CASL type. Core only needs to ask whether a named action is allowed on a
 * named subject; it does not compile CASL conditions into SQL.
 */
export interface SapportaAbility {
  can(action: string, subject: string): boolean;
}

/**
 * Builds the request ability from the same facts that row security receives.
 * Role checks should read `principal.membership.roles`; row access should read
 * `rowsAllowedForRequest`.
 */
export type BuildAbility<
  AppAbility,
  Membership extends WorkspaceMembership = WorkspaceMembership,
> = (facts: {
  principal: Principal<Membership>;
  rowsAllowedForRequest: RowsAllowedForRequest;
}) => AppAbility;
