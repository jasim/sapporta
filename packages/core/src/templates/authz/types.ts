import type { MongoAbility } from "@casl/ability";
import type {
  AuthWorkspace,
  Principal,
  RowsAllowedForRequest,
  WorkspaceMembership,
} from "@sapporta/server";

export type AppWorkspaceRole = "owner" | "member";

/**
 * Roles belong to the user's membership in the current workspace. Add your
 * domain roles here when the same user can do different work in different
 * workspaces.
 */
export type AppWorkspaceMembership = Omit<
  WorkspaceMembership,
  "roles"
> & {
  workspace: AuthWorkspace;
  roles: readonly AppWorkspaceRole[];
};

export type AppPrincipal = Principal<AppWorkspaceMembership>;

export type AppAction =
  | "manage"
  | "read"
  | "create"
  | "update"
  | "delete"
  | "export"
  | "run";

export type AppSubject = "all" | string;

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Facts available while building the request ability.
 *
 * Use `principal` for who is asking and `rowsAllowedForRequest` for which row
 * facts the request may use. Do not treat an owner role as a shortcut for wider
 * row access; choose the row boundary in `resolveRowsAllowedForRequest`.
 */
export type AppAuthFacts = {
  principal: AppPrincipal;
  rowsAllowedForRequest: RowsAllowedForRequest;
};
