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
  switchActiveWorkspaceRoute,
  type AuthBootstrapStatus,
  type AuthContextResponse,
} from "@sapporta/shared/contracts";
import { authFailure } from "./errors.js";
import { requireAuthContext } from "./middleware.js";
import { WorkspaceSwitchError } from "./workspace.js";

export interface ProjectAuthRoutesOptions {
  conn: ProjectDbConnection;
  switchActiveWorkspace: (
    c: Context<SapportaEnv>,
    workspaceId: string,
  ) => Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>>;
}

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

  api.register("switchActiveWorkspace", switchActiveWorkspaceRoute, async ({ c, request }) => {
    try {
      const auth = await options.switchActiveWorkspace(c, request.body.workspaceId);
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

export function authBootstrapStatus(
  conn: ProjectDbConnection,
): AuthBootstrapStatus {
  const userCount = countRows(conn, "user");
  const workspaceCount = countRows(conn, "organization");
  return {
    userCount,
    workspaceCount,
    isEmpty: userCount === 0 && workspaceCount === 0,
  };
}

export function authContextResponse(
  auth: SapportaAuthContext<AppAbility, AppWorkspaceMembership>,
): AuthContextResponse {
  if (auth.principal.kind !== "user") {
    throw new Error("A signed-in user is required to build auth context response.");
  }
  // The frontend contract is intentionally user-shaped. Derive it from the
  // principal membership so route code does not grow a second owner/role model.
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

function countRows(
  conn: ProjectDbConnection,
  tableName: "user" | "organization",
): number {
  const row = conn.sqlite
    .prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`)
    .get();
  return readCount(row);
}

function readCount(row: unknown): number {
  if (typeof row !== "object" || row === null || !("count" in row)) return 0;
  const count = row.count;
  return typeof count === "number" ? count : 0;
}
