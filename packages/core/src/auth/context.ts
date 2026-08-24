import type { TimeZone } from "@sapporta/shared/temporal";
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

/**
 * The calendar this request works in.
 *
 * Every day-shaped decision a handler makes reads its zone from here: the
 * bounds of a day-bounded filter, the buckets of a grouped report, the wall
 * clock a timestamp is shown on. There is one such value per request and it
 * comes from the workspace the request already resolved, so no route carries a
 * time zone parameter and no handler performs a lookup of its own.
 *
 *   const zone = workspaceTimeZone(c.get("auth"));
 *
 * The zone is read from the row authority rather than from the principal's
 * membership, so that the calendar matches the rows being grouped. The two
 * name the same workspace on an ordinary request, and can differ on a route
 * composed for a workspace the caller is not a member of — a public page —
 * where the rows are the ones to follow. Either authority answers alike: both
 * are built from one workspace record.
 *
 * Throws for a request with no workspace — an anonymous public route, or one
 * holding only `systemGlobalOnly` authority. A request with no workspace has
 * no calendar, and the right answer to asking for one is an error rather than
 * UTC, which would silently be wrong for every workspace that does not keep
 * it.
 */
export function workspaceTimeZone<
  AppAbility,
  Membership extends WorkspaceMembership,
>(auth: SapportaAuthContext<AppAbility, Membership>): TimeZone {
  const { workspaceGlobalOnly, workspaceUserScoped } =
    auth.dataAuthority.rowAuthorities;
  const workspace =
    workspaceGlobalOnly?.workspace ?? workspaceUserScoped?.workspace;
  if (!workspace) {
    throw new Error(
      "This request has no workspace, so it has no calendar to read days in. " +
        "workspaceTimeZone() needs a request carrying workspaceGlobalOnly or " +
        "workspaceUserScoped authority.",
    );
  }
  return workspace.timeZone;
}
