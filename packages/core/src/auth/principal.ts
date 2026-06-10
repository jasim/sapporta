/**
 * Describes who is making a request, independent from which rows the request
 * may touch.
 *
 * A signed-in user, an anonymous visitor, an API key, and a service account can
 * all be principals. Row visibility is intentionally modeled elsewhere so a
 * public workspace page can be anonymous while still being limited to a known
 * workspace's public rows.
 */
export type WorkspaceRole = "owner" | "member";

/**
 * The user's relationship to the current workspace.
 *
 * Roles live on the membership, not the user, because the same user can be an
 * owner in one workspace and a member in another. Applications can extend the
 * role vocabulary and keep presenting the resolved role set here.
 */
export type WorkspaceMembership<
  Role extends string = WorkspaceRole,
> = {
  id: string;
  roles: readonly Role[];
};

/** Workspace facts that auth and row-security decisions can safely rely on. */
export type AuthWorkspace = {
  id: string;
  name: string;
  slug: string;
};

/** User facts copied from the active session provider. */
export type SapportaAuthUser = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
};

/**
 * The requester for one request.
 *
 * Anonymous is a real state, not a placeholder user. Do not create fake users,
 * sessions, memberships, roles, or workspace ids for public traffic; keep the
 * principal anonymous and express any allowed row facts with
 * `RowsAllowedForRequest`.
 */
export type Principal<
  Membership extends WorkspaceMembership = WorkspaceMembership,
> =
  | { kind: "anonymous" }
  | {
      kind: "user";
      user: SapportaAuthUser;
      membership: Membership;
    };

export function anonymousPrincipal<
  Membership extends WorkspaceMembership = WorkspaceMembership,
>(): Principal<Membership> {
  return { kind: "anonymous" };
}

/**
 * Wraps already-resolved user and membership facts. This constructor does not
 * load data, choose a workspace, or grant row access.
 */
export function userPrincipal<
  Membership extends WorkspaceMembership,
>(input: {
  user: SapportaAuthUser;
  membership: Membership;
}): Principal<Membership> {
  return {
    kind: "user",
    user: input.user,
    membership: input.membership,
  };
}
