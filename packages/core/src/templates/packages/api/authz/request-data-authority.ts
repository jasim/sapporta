import type { Context } from "hono";
import {
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  type RequestDataAuthority,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
} from "@sapporta/server";
import type { AppPrincipal } from "./types.js";

/**
 * Defines which rows this request may access.
 *
 * The starter app keeps anonymous requests limited to system-wide tables, and
 * gives a signed-in request everything in its active workspace: the rows that
 * account owns, and every other member's rows too. Drop the
 * `workspaceGlobalOnly` line to limit a request to the account's own rows.
 * For a public workspace feature, first verify that the requested workspace
 * has enabled that feature, then compose the authorities that route needs.
 *
 * This is the only place row access is decided for a request. Every request
 * the app serves arrives here, and the request is always present - there is no
 * second resolver, and no case where a served request settles its row access
 * somewhere else. (`pnpm seed` does not serve requests; it takes a fixed set
 * of authorities for the demo workspace it fills.)
 */
export async function resolveRequestDataAuthority(input: {
  principal: AppPrincipal;
  c: Context;
}): Promise<RequestDataAuthority> {
  if (input.principal.kind !== "user") {
    return requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
    });
  }
  const workspace = input.principal.membership.workspace;
  return requestDataAuthority({
    systemGlobalOnly: systemGlobalOnlyAuthority(),
    workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
    workspaceUserScoped: workspaceUserScopedAuthority({
      workspace,
      user: input.principal.user,
    }),
  });
}
