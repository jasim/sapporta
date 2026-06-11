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
  requireVerifiedEmail?: boolean;
}

/**
 * Resolve the request principal before API handlers run.
 *
 * Public and private routes both receive an auth context. That keeps row
 * security decisions consistent: a public route still sees an anonymous
 * principal unless the caller supplied a valid session or token.
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
 * Keep API routes private unless they are explicitly listed as public.
 *
 * A public route pattern only lets anonymous traffic reach the handler. It does
 * not grant permissions and it does not bypass row security. Handlers for
 * table-backed data should still read `c.get("auth")`, check `auth.ability`,
 * and compose their query with `auth.rowSecurity`.
 */
export function rejectAnonymousByDefault<E extends SapportaEnv>(
  options: AnonymousGateOptions = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (matchesPublicRoute(c, options.publicRoutes ?? [])) return next();
    if (auth.principal.kind === "user") {
      if (options.requireVerifiedEmail && !auth.principal.user.emailVerified) {
        const failure = authFailure("email_not_verified");
        return c.json(failure.body, failure.status);
      }
      return next();
    }

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
  // Owner can allow a workflow such as inviting users or changing settings, but
  // it does not widen the row boundary for user-scoped tables.
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
