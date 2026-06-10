import type { AuthWorkspace, SapportaAuthUser } from "./principal.js";

/**
 * The trusted row-access facts for one request.
 *
 * This is not a permission grant. CASL decides whether the principal may run
 * an action; this value tells Sapporta which trusted ownership facts it may use
 * when composing row predicates and trusted insert values.
 *
 * The variants are cumulative. `allowWorkspaceWideRows` can also access
 * system-wide rows, and `allowWorkspaceUserRows` can also access workspace-wide
 * and system-wide rows.
 *
 * Choose this value from the route's data boundary, not from the user's role
 * alone. An owner can be allowed to run a feature while the feature still uses
 * user-scoped rows, and a public feature can be anonymous while using
 * explicitly resolved workspace-wide rows.
 */
export type RowsAllowedForRequest =
  | { kind: "allowOnlySystemWideRows" }
  | { kind: "allowWorkspaceWideRows"; workspace: AuthWorkspace }
  | {
      kind: "allowWorkspaceUserRows";
      workspace: AuthWorkspace;
      user: SapportaAuthUser;
    };

export function allowOnlySystemWideRows(): RowsAllowedForRequest {
  return { kind: "allowOnlySystemWideRows" };
}

/**
 * Allows system-wide rows plus rows owned by one workspace. Public routes
 * should return this only after confirming that the workspace has enabled the
 * public feature being served.
 */
export function allowWorkspaceWideRows(
  workspace: AuthWorkspace,
): RowsAllowedForRequest {
  return { kind: "allowWorkspaceWideRows", workspace };
}

/**
 * Allows system-wide rows, workspace-wide rows, and rows scoped to the current
 * user inside that workspace.
 */
export function allowWorkspaceUserRows(input: {
  workspace: AuthWorkspace;
  user: SapportaAuthUser;
}): RowsAllowedForRequest {
  return {
    kind: "allowWorkspaceUserRows",
    workspace: input.workspace,
    user: input.user,
  };
}
