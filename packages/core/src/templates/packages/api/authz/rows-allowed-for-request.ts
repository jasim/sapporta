import type { Context } from "hono";
import {
  allowOnlySystemWideRows,
  allowWorkspaceUserRows,
  type RowsAllowedForRequest,
} from "@sapporta/server";
import type { AppPrincipal } from "./types.js";

/**
 * Chooses the trusted row boundary for this request.
 *
 * The starter app keeps anonymous requests system-only and signed-in requests
 * limited to the user's own rows in the active workspace. For a public
 * workspace feature, first verify that the requested workspace has enabled that
 * feature, then return `allowWorkspaceWideRows(workspace)` for that route.
 */
export async function resolveRowsAllowedForRequest(input: {
  principal: AppPrincipal;
  c: Context;
}): Promise<RowsAllowedForRequest> {
  if (input.principal.kind !== "user") return allowOnlySystemWideRows();
  return allowWorkspaceUserRows({
    workspace: input.principal.membership.workspace,
    user: input.principal.user,
  });
}
