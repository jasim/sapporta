import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";
import type {
  RowsAllowedForRequest,
  SapportaAuthContext,
  SapportaEnv,
} from "@sapporta/server";
import { authFailure } from "./errors.js";

export type ResolveProjectAuth<E extends SapportaEnv = SapportaEnv> = (
  c: Context<E>,
) => SapportaAuthContext | Promise<SapportaAuthContext>;

export type PublicRoutePattern =
  | string
  | {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
    };

export interface AnonymousGateOptions {
  publicRoutes?: readonly PublicRoutePattern[];
}

/**
 * Resolves auth before route code runs. This middleware should run for API
 * routes whether the request has a session or not, so public routes can use the
 * same ability and row-security path as signed-in routes.
 */
export function resolveProjectAuthMiddleware<E extends SapportaEnv>(
  resolveAuth: ResolveProjectAuth<E>,
): MiddlewareHandler<E> {
  return async (c, next) => {
    c.set("auth", await resolveAuth(c));
    return next();
  };
}

/**
 * Keeps authenticated APIs private by default.
 *
 * A public route pattern only lets anonymous traffic reach the route. It does
 * not grant CASL permissions and it does not skip row security; the route must
 * still call `forbidUnless(c, auth.ability.can(...))` before reading or writing
 * application data.
 */
export function rejectAnonymousByDefault<E extends SapportaEnv>(
  options: AnonymousGateOptions = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (auth.principal.kind === "user") return next();
    if (matchesPublicRoute(c, options.publicRoutes ?? [])) return next();

    const failure = authFailure("unauthenticated");
    return c.json(failure.body, failure.status);
  };
}

export function requireAuthContext<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = c.get("auth");
  if (!auth) throwAuth("unauthenticated");
  return auth;
}

export function requirePrincipalUser<E extends SapportaEnv>(
  c: Context<E>,
): Extract<SapportaAuthContext["principal"], { kind: "user" }> {
  const auth = requireAuthContext(c);
  if (auth.principal.kind !== "user") throwAuth("unauthenticated");
  return auth.principal;
}

export function requireVerifiedUser<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = requireAuthContext(c);
  if (auth.principal.kind !== "user") throwAuth("unauthenticated");
  if (!auth.principal.user.emailVerified) throwAuth("email_not_verified");
  return auth;
}

export function requireWorkspaceRowsAllowed<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext & {
  rowsAllowedForRequest: Extract<
    RowsAllowedForRequest,
    { kind: "allowWorkspaceWideRows" | "allowWorkspaceUserRows" }
  >;
} {
  const auth = requireAuthContext(c);
  if (
    auth.rowsAllowedForRequest.kind !== "allowWorkspaceWideRows" &&
    auth.rowsAllowedForRequest.kind !== "allowWorkspaceUserRows"
  ) {
    throwAuth("workspace_required");
  }
  return auth as SapportaAuthContext & {
    rowsAllowedForRequest: Extract<
      RowsAllowedForRequest,
      { kind: "allowWorkspaceWideRows" | "allowWorkspaceUserRows" }
    >;
  };
}

export function requireWorkspaceOwner<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext & {
  rowsAllowedForRequest: Extract<
    RowsAllowedForRequest,
    { kind: "allowWorkspaceWideRows" | "allowWorkspaceUserRows" }
  >;
} {
  const auth = requireWorkspaceRowsAllowed(c);
  // Owner is a membership role. This check can allow a workflow, but it does
  // not widen `auth.rowsAllowedForRequest` for user-scoped tables.
  if (
    auth.principal.kind !== "user" ||
    !auth.principal.membership.roles.includes("owner")
  ) {
    throwAuth("forbidden");
  }
  return auth;
}

function matchesPublicRoute<E extends SapportaEnv>(
  c: Context<E>,
  patterns: readonly PublicRoutePattern[],
): boolean {
  for (const pattern of patterns) {
    const method = typeof pattern === "string" ? undefined : pattern.method;
    const path = typeof pattern === "string" ? pattern : pattern.path;
    if (method && method !== c.req.method) continue;
    if (matchesPath(path, c.req.path)) return true;
  }
  return false;
}

function matchesPath(pattern: string, path: string): boolean {
  if (pattern.endsWith("*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return pattern === path;
}

function throwAuth(code: Parameters<typeof authFailure>[0]): never {
  const failure = authFailure(code);
  throw new HTTPException(failure.status, {
    res: Response.json(failure.body, { status: failure.status }),
  });
}
