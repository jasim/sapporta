import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";
import type { SapportaAuthContext, SapportaEnv } from "@sapporta/server";
import { ownsActiveWorkspace } from "@sapporta/server";
import { authFailure } from "./errors.js";

export type ResolveProjectAuth<E extends SapportaEnv = SapportaEnv> = (
  c: Context<E>,
) =>
  | SapportaAuthContext
  | null
  | undefined
  | Promise<SapportaAuthContext | null | undefined>;

export interface ProjectAuthMiddlewareOptions<
  E extends SapportaEnv = SapportaEnv,
> {
  /** Reject signed-in users whose email is not verified. */
  requireVerifiedEmail?: boolean;
  /** Allows public routes such as `/api/auth/*` to bypass project auth. */
  skip?: (c: Context<E>) => boolean;
}

/**
 * Installs project auth for protected API routes.
 *
 * The resolver owns Better Auth/session lookup. This middleware enforces the
 * generated project's email/workspace policy and stores the table-bound
 * `SapportaAuthContext` on Hono as `auth`.
 */
export function createProjectAuthMiddleware<E extends SapportaEnv>(
  resolveAuth: ResolveProjectAuth<E>,
  options: ProjectAuthMiddlewareOptions<E> = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    if (options.skip?.(c) === true) {
      return next();
    }

    const auth = await resolveAuth(c);
    if (!auth) {
      const failure = authFailure("unauthenticated");
      return c.json(failure.body, failure.status);
    }

    if (options.requireVerifiedEmail === true && !auth.user.emailVerified) {
      const failure = authFailure("email_not_verified");
      return c.json(failure.body, failure.status);
    }

    if (!auth.workspace.id || !auth.member.id) {
      const failure = authFailure("workspace_required");
      return c.json(failure.body, failure.status);
    }

    c.set("auth", auth);
    return next();
  };
}

/** Returns the current auth context, requiring only a signed-in user. */
export function requireOnlyBareLoggedInUser<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = c.get("auth");
  if (!auth) throwAuth("unauthenticated");
  return auth;
}

/** Returns the current auth context and requires a verified email address. */
export function requireOnlyBareVerifiedUser<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = requireOnlyBareLoggedInUser(c);
  if (!auth.user.emailVerified) throwAuth("email_not_verified");
  return auth;
}

/**
 * Returns the current auth context and requires an active workspace membership.
 * Use this by default for product/domain routes.
 */
export function requireWorkspaceUser<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = requireOnlyBareLoggedInUser(c);
  if (!auth.workspace.id || !auth.member.id) throwAuth("workspace_required");
  return auth;
}

/**
 * Returns the current auth context and requires owner access to the active
 * workspace. Generated framework routes use this by default.
 */
export function requireWorkspaceOwner<E extends SapportaEnv>(
  c: Context<E>,
): SapportaAuthContext {
  const auth = requireWorkspaceUser(c);
  if (!ownsActiveWorkspace(auth) || auth.member.role !== "owner") {
    throwAuth("forbidden");
  }
  return auth;
}

function throwAuth(code: Parameters<typeof authFailure>[0]): never {
  const failure = authFailure(code);
  throw new HTTPException(failure.status, {
    res: Response.json(failure.body, { status: failure.status }),
  });
}
