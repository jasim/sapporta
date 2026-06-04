import type { Context } from "hono";
import type {
  ProjectDbConnection,
  SapportaAuthContext,
  SapportaEnv,
  TableCatalog,
} from "@sapporta/server";
import { createBetterAuth, type ProjectBetterAuth } from "./better-auth.js";
import {
  resolveSapportaAuthContext,
  switchActiveWorkspace as switchActiveWorkspaceContext,
} from "./context.js";
import { createProjectAuthRoutes } from "./routes.js";
import type { ProjectAuthEnv } from "./env.js";
import {
  createProjectAuthMiddleware,
  requireWorkspaceOwner,
  requireWorkspaceUser,
} from "./middleware.js";

export interface CreateProjectAuthOptions {
  conn: ProjectDbConnection;
  env: ProjectAuthEnv;
  catalog: TableCatalog;
}

export interface ProjectAuth {
  auth: ProjectBetterAuth;
  env: ProjectAuthEnv;
  routes: ReturnType<typeof createProjectAuthRoutes>;
  middleware: ReturnType<typeof createProjectAuthMiddleware<SapportaEnv>>;
  isAuthRoute: (c: Context<SapportaEnv>) => boolean;
  resolveAuth: (c: Context<SapportaEnv>) => Promise<SapportaAuthContext | null>;
  requireWorkspaceUser: (c: Context<SapportaEnv>) => SapportaAuthContext;
  requireWorkspaceOwner: (c: Context<SapportaEnv>) => SapportaAuthContext;
  switchActiveWorkspace: (
    c: Context<SapportaEnv>,
    workspaceId: string,
  ) => Promise<SapportaAuthContext>;
}

export function createProjectAuth({
  conn,
  env,
  catalog,
}: CreateProjectAuthOptions): ProjectAuth {
  const auth = createBetterAuth({ conn, env });
  const isAuthRoute = (c: Context<SapportaEnv>) =>
    c.req.path.startsWith("/api/auth/") ||
    c.req.path === "/api/auth-bootstrap";
  const resolveAuth = (c: Context<SapportaEnv>) =>
    resolveSapportaAuthContext(auth.api, conn, catalog, c.req.raw.headers);

  return {
    auth,
    env,
    routes: createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: (c, workspaceId) =>
        switchActiveWorkspaceContext(
          auth.api,
          conn,
          catalog,
          c.req.raw.headers,
          workspaceId,
        ),
    }),
    middleware: createProjectAuthMiddleware(resolveAuth, {
      requireVerifiedEmail: env.requireVerifiedEmail,
      skip: isAuthRoute,
    }),
    isAuthRoute,
    resolveAuth,
    requireWorkspaceUser,
    requireWorkspaceOwner,
    switchActiveWorkspace: (c, workspaceId) =>
      switchActiveWorkspaceContext(
        auth.api,
        conn,
        catalog,
        c.req.raw.headers,
        workspaceId,
      ),
  };
}

export { createBetterAuth, type ProjectBetterAuth } from "./better-auth.js";
export {
  authContextFromPayload,
  resolveSapportaAuthContext,
  switchActiveWorkspace,
  type BetterAuthSessionPayload,
} from "./context.js";
export { readProjectAuthEnv, type ProjectAuthEnv } from "./env.js";
export { createProjectAuthRoutes, authContextResponse } from "./routes.js";
export {
  authErrorBody,
  authErrorStatus,
  authFailure,
  projectAuthErrorCodes,
  type ProjectAuthErrorBody,
  type ProjectAuthErrorCode,
  type ProjectAuthErrorStatus,
  type ProjectAuthFailure,
} from "./errors.js";
export {
  createProjectAuthMiddleware,
  requireOnlyBareLoggedInUser,
  requireOnlyBareVerifiedUser,
  requireWorkspaceOwner,
  requireWorkspaceUser,
  type ProjectAuthMiddlewareOptions,
  type ResolveProjectAuth,
} from "./middleware.js";
export * from "./workspace.js";
