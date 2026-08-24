import type { Context } from "hono";
import type {
  BuildAbility,
  OpenApiPolicy,
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
 * Connects sign-in to the application's permissions and row access.
 *
 * The middleware resolves each browser session or access token and stores the
 * result at `c.get("auth")`. It also provides the sign-in, workspace, and
 * access-token routes mounted by `boot.ts`.
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
  /**
   * Resolves the auth context for a served request, from its credentials.
   *
   * This is the only way a request obtains one. A command-line script builds
   * its own in `packages/api/script-runtime.ts`, after proving the password of
   * the account it signs in as.
   */
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

/**
 * The generated app contract at `/api/openapi.json`.
 *
 * This route is gated twice. The framework applies `SAPPORTA_OPENAPI_POLICY`
 * in `mountSapportaFramework`, and this anonymous gate runs first because
 * `boot.ts` installs it over `/api/*` before the framework mounts. Only this
 * gate rejects an anonymous caller, so it decides whether the framework's
 * policy is ever consulted.
 */
const openApiRoute = {
  method: "GET",
  path: "/api/openapi.json",
} as const satisfies PublicRoutePattern;

/**
 * Decide whether the anonymous gate lets a request for the contract through
 * to the framework's own policy.
 *
 * Under `public` it must, so the document is served. Under `disabled` it must
 * too, so the framework can answer 404 — the honest reply for a route the
 * deployment chose not to serve. Held back under `disabled`, an anonymous
 * caller would instead get 401, which says the contract is there and needs a
 * credential that would never work.
 *
 * Under `authenticated` it must not: this gate is what rejects an anonymous
 * caller. The framework's guard resolves the request's auth context and an
 * anonymous context is still a context, so the framework alone would let the
 * request through.
 */
function openApiRouteReachesFramework(policy: OpenApiPolicy): boolean {
  return policy !== "authenticated";
}

/**
 * List every route an anonymous caller may reach.
 *
 * Only the app contract is conditional, and only on `SAPPORTA_OPENAPI_POLICY`.
 * Nothing else here reads workspace data: `/api/auth-bootstrap` reports
 * whether the app needs its first user, `/api/meta/info` returns the project
 * name and slug, and the contract describes this app's own routes. Routes the
 * application chooses to publish arrive in `publicRoutes` from `app.ts`.
 *
 * Being reachable is not being permitted. Every handler still reads
 * `c.get("auth")` and checks its own abilities and row security, and the
 * contract is answered by the framework policy that this list defers to.
 */
export function anonymousPublicRoutes(
  env: ProjectAuthEnv,
  publicRoutes: readonly PublicRoutePattern[] = [],
): readonly PublicRoutePattern[] {
  return [
    ...defaultPublicRoutes,
    ...(openApiRouteReachesFramework(env.openapiPolicy) ? [openApiRoute] : []),
    ...publicRoutes,
  ];
}

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
      resolveAuth,
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
      publicRoutes: anonymousPublicRoutes(env, publicRoutes),
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
export { findUserByEmail, findUserById } from "./user.js";
export {
  resolvePrincipal,
  resolveSapportaAuthContext,
  switchActiveWorkspace,
  userFromSessionPayload,
  type BetterAuthSessionPayload,
  type ResolveRequestDataAuthority,
  type ResolveSapportaAuthContextInput,
} from "./context.js";
export {
  isEmailVerificationRequired,
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
/**
 * Named one by one rather than with `export *`. What this module publishes is
 * a security surface, so adding a function to `workspace.ts` should not
 * publish it by accident. `sample-data.ts` is deliberately absent: `pnpm seed`
 * imports it by path.
 */
export {
  createInitialWorkspace,
  ensureActiveWorkspace,
  ensureWorkspaceMembership,
  findFirstMembership,
  findMembership,
  membershipFromRow,
  setActiveWorkspace,
  setWorkspaceTimeZone,
  switchWorkspaceMembership,
  WorkspaceSwitchError,
  type WorkspaceMembershipRow,
  type WorkspaceOwner,
} from "./workspace.js";
