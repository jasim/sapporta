import type { Context } from "hono";
import {
  TsRestApi,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import type { AppAbility, AppWorkspaceMembership } from "../authz/types.js";
import {
  getAuthBootstrapStatusRoute,
  getAuthContextRoute,
  listAuthTokensRoute,
  createAuthTokenRoute,
  revokeAuthTokenRoute,
  switchActiveWorkspaceRoute,
  updateWorkspaceTimeZoneRoute,
  type AuthBootstrapStatus,
  type AuthContextResponse,
} from "@sapporta/shared/contracts";
import { isValidTimeZone } from "@sapporta/shared/temporal";
import { authFailure } from "./errors.js";
import {
  requireAuthContext,
  requireAuthorizedInteractiveWorkspaceUserData,
  requireWorkspaceOwner,
  type WorkspaceUserDataAuthority,
} from "./middleware.js";
import { setWorkspaceTimeZone, WorkspaceSwitchError } from "./workspace.js";
import {
  createAuthToken,
  type AuthTokenManagementScope,
  listAuthTokens,
  revokeAuthToken,
  TokenManagementError,
} from "./auth-tokens.js";

export interface ProjectAuthRoutesOptions {
  conn: ProjectDbConnection;
  /** Resolves a request's auth context from its credentials, as the
   *  middleware does. A route that changes a workspace field calls it again
   *  to answer from the row it just wrote. */
  resolveAuth: (
    c: Context<SapportaEnv>,
  ) => Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>>;
  switchActiveWorkspace: (
    c: Context<SapportaEnv>,
    workspaceId: string,
  ) => Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>>;
}

const authTokenSubject = "agent_access_token";

/**
 * Auth routes used by the app UI.
 *
 * Browser-session users can read their current auth context, switch their
 * active workspace, and manage agent access tokens. Bearer-token callers may
 * use ordinary app APIs, but they cannot create, list, or revoke tokens; token
 * management stays an interactive browser action.
 */
export function createProjectAuthRoutes(options: ProjectAuthRoutesOptions) {
  const api = new TsRestApi<SapportaEnv>();

  api.register("getAuthBootstrapStatus", getAuthBootstrapStatusRoute, () => ({
    status: 200,
    body: authBootstrapStatus(options.conn),
  }));

  api.register("getAuthContext", getAuthContextRoute, ({ c }) => ({
    status: 200,
    body: authContextResponse(requireAppAuthContext(c)),
  }));

  api.register(
    "switchActiveWorkspace",
    switchActiveWorkspaceRoute,
    async ({ c, request }) => {
      try {
        const auth = await options.switchActiveWorkspace(
          c,
          request.body.workspaceId,
        );
        return {
          status: 200,
          body: authContextResponse(auth),
        };
      } catch (err) {
        if (err instanceof WorkspaceSwitchError) {
          const failure = authFailure("forbidden");
          return {
            status: 403,
            body: failure.body,
          };
        }
        const failure = authFailure("unauthenticated");
        return {
          status: 401,
          body: failure.body,
        };
      }
    },
  );

  /**
   * Sets the calendar the active workspace keeps.
   *
   * Owner only, because the zone is the workspace's and not the caller's:
   * changing it changes which day every timestamp in the application falls on,
   * for everyone in the workspace. The response is a fresh auth context, so
   * the browser that made the change publishes the new zone through the same
   * path it publishes a workspace switch through.
   */
  api.register(
    "updateWorkspaceTimeZone",
    updateWorkspaceTimeZoneRoute,
    async ({ c, request }) => {
      const auth = requireWorkspaceOwner(c);
      const { timeZone } = request.body;
      // Checked against this server's own tz database, which is the one every
      // report will group with. A name only the browser knows would store
      // fine and then fail on the next request that read the row.
      if (!isValidTimeZone(timeZone)) {
        const failure = authFailure(
          "validation_failed",
          `${JSON.stringify(timeZone)} is not a time zone this server knows. ` +
            `Use an IANA id such as "Asia/Kolkata" or "America/New_York".`,
        );
        return { status: 422, body: failure.body };
      }
      const workspace =
        auth.dataAuthority.rowAuthorities.workspaceGlobalOnly.workspace;
      setWorkspaceTimeZone(options.conn, workspace.id, timeZone);
      // The context in hand was resolved from the workspace row before the
      // update, so it still reads on the previous zone — and a request holds
      // that row in more than one place, on the principal's membership and
      // again on each row authority naming it. Resolving the request again
      // rebuilds all of them from what was just written, which is the same
      // path every other request takes to the same answer.
      return {
        status: 200,
        body: authContextResponse(await options.resolveAuth(c)),
      };
    },
  );

  api.register("listAuthTokens", listAuthTokensRoute, ({ c }) => {
    const auth = requireTokenManagementAccess(c, "read");
    return {
      status: 200,
      body: {
        tokens: listAuthTokens(
          options.conn,
          auth.principal.user.id,
          auth.dataAuthority.rowAuthorities.workspaceUserScoped.workspace.id,
        ),
      },
    };
  });

  api.register("createAuthToken", createAuthTokenRoute, ({ c, request }) => {
    try {
      const auth = requireTokenManagementAccess(c, "create");
      return {
        status: 201,
        body: createAuthToken(
          options.conn,
          auth.principal,
          request.body,
          tokenManagementScope(auth),
        ),
      };
    } catch (err) {
      if (err instanceof TokenManagementError) {
        const failure = authFailure("forbidden");
        return {
          status: 403,
          body: failure.body,
        };
      }
      throw err;
    }
  });

  api.register("revokeAuthToken", revokeAuthTokenRoute, ({ c, request }) => {
    const auth = requireTokenManagementAccess(c, "delete");
    const revoked = revokeAuthToken(
      options.conn,
      auth.principal.user.id,
      request.params.id,
      auth.dataAuthority.rowAuthorities.workspaceUserScoped.workspace.id,
    );
    if (!revoked) {
      const failure = authFailure("not_found");
      return {
        status: 404,
        body: failure.body,
      };
    }
    return {
      status: 204,
      body: undefined,
    };
  });

  return api;
}

function requireAppAuthContext(
  c: Context<SapportaEnv>,
): SapportaAuthContext<AppAbility, AppWorkspaceMembership> {
  return requireAuthContext(c) as SapportaAuthContext<
    AppAbility,
    AppWorkspaceMembership
  >;
}

function requireTokenManagementAccess(
  c: Context<SapportaEnv>,
  action: "read" | "create" | "delete",
): TokenManagementAuthContext {
  const auth = requireAuthorizedInteractiveWorkspaceUserData(c, {
    action,
    subject: authTokenSubject,
  });
  return auth as TokenManagementAuthContext;
}

type TokenManagementAuthContext = SapportaAuthContext<
  AppAbility,
  AppWorkspaceMembership
> & {
  principal: Extract<
    SapportaAuthContext<AppAbility, AppWorkspaceMembership>["principal"],
    { kind: "user" }
  >;
  dataAuthority: WorkspaceUserDataAuthority;
};

function tokenManagementScope(
  auth: ReturnType<typeof requireTokenManagementAccess>,
): AuthTokenManagementScope {
  return {
    userId: auth.principal.user.id,
    organizationId:
      auth.dataAuthority.rowAuthorities.workspaceUserScoped.workspace.id,
  };
}

export function authBootstrapStatus(
  conn: ProjectDbConnection,
): AuthBootstrapStatus {
  if (hasExistingAuthSetup(conn)) return {};
  return { shouldShowSignUp: true };
}

export function authContextResponse(
  auth: SapportaAuthContext<AppAbility, AppWorkspaceMembership>,
): AuthContextResponse {
  if (auth.principal.kind !== "user") {
    throw new Error(
      "A signed-in user is required to build auth context response.",
    );
  }
  // The UI reads one active workspace. Additional workspace switching can build
  // on the memberships array without changing the shape of the current context.
  const membership = auth.principal.membership;
  const workspace = membership.workspace;
  const role = membership.roles.includes("owner") ? "owner" : "member";
  const isOwner = role === "owner";
  return {
    user: auth.principal.user,
    workspace: {
      ...workspace,
      isOwner,
    },
    memberships: [
      {
        id: membership.id,
        workspace,
        role,
        isOwner,
      },
    ],
    role,
    isOwner,
  };
}

function hasExistingAuthSetup(conn: ProjectDbConnection): boolean {
  const row = conn.sqlite
    .prepare(
      `
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM "user") THEN 1
          WHEN EXISTS (SELECT 1 FROM "organization") THEN 1
          ELSE 0
        END AS hasExistingAuthSetup
      `,
    )
    .get();
  return readSqliteBoolean(row, "hasExistingAuthSetup");
}

function readSqliteBoolean(row: unknown, field: string): boolean {
  if (typeof row !== "object" || row === null || !(field in row)) return false;
  const record = row as Record<string, unknown>;
  return record[field] === 1;
}
