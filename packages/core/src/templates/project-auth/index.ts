import type { Context } from "hono";
import type {
  BuildAbility,
  ProjectDbConnection,
  SapportaAuthContext,
  SapportaEnv,
  TableCatalog,
} from "@sapporta/server";
import type { SapportaMailer } from "../mailer.js";
import type { AppAbility, AppWorkspaceMembership } from "../authz/types.js";
import { createBetterAuth, type ProjectBetterAuth } from "./better-auth.js";
import {
  resolveSapportaAuthContext,
  switchActiveWorkspace as switchActiveWorkspaceContext,
  type ResolveRequestDataAuthority,
} from "./context.js";
import { createProjectAuthRoutes } from "./routes.js";
import type { ProjectAuthEnv } from "./env.js";
import {
  rejectAnonymousByDefault,
  requireAuthContext,
  requirePrincipalUser,
  requireAuthorizedInteractiveWorkspaceUserData,
  requireAuthorizedSystemData,
  requireAuthorizedWorkspaceData,
  requireAuthorizedWorkspaceUserData,
  requireVerifiedUser,
  requireWorkspaceOwner,
  requireWorkspaceRowsAllowed,
  resolveProjectAuthMiddleware,
  type PublicRoutePattern,
} from "./middleware.js";

/**
 * Creates the request auth model for this application.
 *
 * The resulting object gives `boot.ts` the pieces it needs to keep private API
 * routes private by default, allow selected public routes, resolve browser
 * sessions and agent access tokens, and expose token-management screens in the
 * app UI.
 */
export interface CreateProjectAuthOptions {
  conn: ProjectDbConnection;
  env: ProjectAuthEnv;
  catalog: TableCatalog;
  mailer: SapportaMailer;
  buildAbility: BuildAbility<AppAbility, AppWorkspaceMembership>;
  resolveRequestDataAuthority: ResolveRequestDataAuthority;
  publicRoutes?: readonly PublicRoutePattern[];
}

export interface ProjectAuth {
  auth: ProjectBetterAuth;
  env: ProjectAuthEnv;
  routes: ReturnType<typeof createProjectAuthRoutes>;
  resolveMiddleware: ReturnType<
    typeof resolveProjectAuthMiddleware<SapportaEnv>
  >;
  rejectAnonymousMiddleware: ReturnType<
    typeof rejectAnonymousByDefault<SapportaEnv>
  >;
  resolveAuth: (
    c: Context<SapportaEnv>,
  ) => Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>>;
  requireAuthContext: (c: Context<SapportaEnv>) => SapportaAuthContext;
  requirePrincipalUser: (
    c: Context<SapportaEnv>,
  ) => Extract<SapportaAuthContext["principal"], { kind: "user" }>;
  requireVerifiedUser: (c: Context<SapportaEnv>) => SapportaAuthContext;
  requireWorkspaceRowsAllowed: (c: Context<SapportaEnv>) => SapportaAuthContext;
  requireWorkspaceOwner: (c: Context<SapportaEnv>) => SapportaAuthContext;
  requireAuthorizedSystemData: typeof requireAuthorizedSystemData;
  requireAuthorizedWorkspaceData: typeof requireAuthorizedWorkspaceData;
  requireAuthorizedWorkspaceUserData: typeof requireAuthorizedWorkspaceUserData;
  requireAuthorizedInteractiveWorkspaceUserData: typeof requireAuthorizedInteractiveWorkspaceUserData;
  switchActiveWorkspace: (
    c: Context<SapportaEnv>,
    workspaceId: string,
  ) => Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>>;
}

const defaultPublicRoutes = [
  { method: "GET", path: "/api/auth-bootstrap" },
  { method: "GET", path: "/api/meta/info" },
] as const satisfies readonly PublicRoutePattern[];

export function createProjectAuth({
  conn,
  env,
  catalog,
  mailer,
  buildAbility,
  resolveRequestDataAuthority,
  publicRoutes = [],
}: CreateProjectAuthOptions): ProjectAuth {
  const auth = createBetterAuth({ conn, env, mailer });
  const resolveAuth = (c: Context<SapportaEnv>) =>
    resolveSapportaAuthContext({
      auth: auth.api,
      conn,
      catalog,
      headers: c.req.raw.headers,
      c,
      buildAbility,
      resolveRequestDataAuthority,
    });

  return {
    auth,
    env,
    routes: createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: (c, workspaceId) =>
        switchActiveWorkspaceContext({
          auth: auth.api,
          conn,
          catalog,
          headers: c.req.raw.headers,
          c,
          buildAbility,
          resolveRequestDataAuthority,
          workspaceId,
        }),
    }),
    resolveMiddleware: resolveProjectAuthMiddleware(resolveAuth),
    rejectAnonymousMiddleware: rejectAnonymousByDefault({
      publicRoutes: [...defaultPublicRoutes, ...publicRoutes],
      requireVerifiedEmail: env.requireVerifiedEmail,
    }),
    resolveAuth,
    requireAuthContext,
    requirePrincipalUser,
    requireVerifiedUser,
    requireWorkspaceRowsAllowed,
    requireWorkspaceOwner,
    requireAuthorizedSystemData,
    requireAuthorizedWorkspaceData,
    requireAuthorizedWorkspaceUserData,
    requireAuthorizedInteractiveWorkspaceUserData,
    switchActiveWorkspace: (c, workspaceId) =>
      switchActiveWorkspaceContext({
        auth: auth.api,
        conn,
        catalog,
        headers: c.req.raw.headers,
        c,
        buildAbility,
        resolveRequestDataAuthority,
        workspaceId,
      }),
  };
}

export { createBetterAuth, type ProjectBetterAuth } from "./better-auth.js";
export {
  membershipFromRow,
  resolvePrincipal,
  resolveSapportaAuthContext,
  switchActiveWorkspace,
  userFromSessionPayload,
  type BetterAuthSessionPayload,
  type ResolveRequestDataAuthority,
  type ResolveSapportaAuthContextInput,
} from "./context.js";
export {
  readProjectAuthEnv,
  type MailTransportKind,
  type ProjectAuthEnv,
  type ProjectMailConfig,
  type ProjectSmtpConfig,
} from "./env.js";
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
  createAuthToken,
  listAuthTokens,
  resolveBearerTokenPrincipal,
  revokeAuthToken,
  TokenAuthError,
  TokenManagementError,
} from "./auth-tokens.js";
export {
  rejectAnonymousByDefault,
  requireAuthContext,
  requireAuthorizedInteractiveWorkspaceUserData,
  requireAuthorizedSystemData,
  requireAuthorizedWorkspaceData,
  requireAuthorizedWorkspaceUserData,
  requirePrincipalUser,
  requireVerifiedUser,
  requireWorkspaceOwner,
  requireWorkspaceRowsAllowed,
  resolveProjectAuthMiddleware,
  type AnonymousGateOptions,
  type PublicRoutePattern,
  type ResolveProjectAuth,
} from "./middleware.js";
export * from "./workspace.js";
