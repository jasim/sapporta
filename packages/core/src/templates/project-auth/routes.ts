import type { Context } from "hono";
import {
  TsRestApi,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import {
  getAuthBootstrapStatusRoute,
  getAuthContextRoute,
  switchActiveWorkspaceRoute,
  type AuthBootstrapStatus,
  type AuthContextResponse,
} from "@sapporta/shared/contracts";
import { authFailure } from "./errors.js";
import { requireOnlyBareLoggedInUser } from "./middleware.js";
import { WorkspaceSwitchError } from "./workspace.js";

export interface ProjectAuthRoutesOptions {
  conn: ProjectDbConnection;
  switchActiveWorkspace: (
    c: Context<SapportaEnv>,
    workspaceId: string,
  ) => Promise<SapportaAuthContext>;
}

export function createProjectAuthRoutes(options: ProjectAuthRoutesOptions) {
  const api = new TsRestApi<SapportaEnv>();

  api.register("getAuthBootstrapStatus", getAuthBootstrapStatusRoute, () => ({
    status: 200,
    body: authBootstrapStatus(options.conn),
  }));

  api.register("getAuthContext", getAuthContextRoute, ({ c }) => ({
    status: 200,
    body: authContextResponse(requireOnlyBareLoggedInUser(c)),
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
  auth: SapportaAuthContext,
): AuthContextResponse {
  return {
    user: auth.user,
    workspace: auth.workspace,
    memberships: [
      {
        id: auth.member.id,
        workspace: {
          id: auth.workspace.id,
          name: auth.workspace.name,
          slug: auth.workspace.slug,
        },
        role: auth.member.role,
        isOwner: auth.workspace.isOwner,
      },
    ],
    role: auth.member.role,
    isOwner: auth.workspace.isOwner,
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
