import { HTTPException } from "hono/http-exception";
import type { Context, MiddlewareHandler } from "hono";
import type {
  RequestDataAuthority,
  SapportaAuthContext,
  SapportaEnv,
  SystemGlobalOnlyAuthority,
  WorkspaceGlobalOnlyAuthority,
  WorkspaceUserScopedAuthority,
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

export type FeatureRequirement = {
  action: string;
  subject: string;
};

export type SystemDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    systemGlobalOnly: SystemGlobalOnlyAuthority;
    workspaceGlobalOnly?: never;
    workspaceUserScoped?: never;
  };
};

export type WorkspaceDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    workspaceGlobalOnly: WorkspaceGlobalOnlyAuthority;
    systemGlobalOnly?: never;
    workspaceUserScoped?: never;
  };
};

export type WorkspaceUserDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    workspaceUserScoped: WorkspaceUserScopedAuthority;
    systemGlobalOnly?: never;
    workspaceGlobalOnly?: never;
  };
};

export type AuthorizedSystemDataContext = SapportaAuthContext & {
  dataAuthority: SystemDataAuthority;
};

export type AuthorizedWorkspaceDataContext = SapportaAuthContext & {
  dataAuthority: WorkspaceDataAuthority;
};

export type AuthorizedWorkspaceUserDataContext = SapportaAuthContext & {
  principal: Extract<SapportaAuthContext["principal"], { kind: "user" }>;
  dataAuthority: WorkspaceUserDataAuthority;
};

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
  dataAuthority: RequestDataAuthority & {
    rowAuthorities: Pick<
      Required<RequestDataAuthority["rowAuthorities"]>,
      "workspaceGlobalOnly"
    >;
  };
} {
  const auth = requireAuthContext(c);
  if (!auth.dataAuthority.rowAuthorities.workspaceGlobalOnly) {
    throwAuth("workspace_required");
  }
  return auth as SapportaAuthContext & {
    dataAuthority: RequestDataAuthority & {
      rowAuthorities: Pick<
        Required<RequestDataAuthority["rowAuthorities"]>,
        "workspaceGlobalOnly"
      >;
    };
  };
}

/** An owner of the active workspace, with the workspace-wide row authority. */
export type AuthorizedWorkspaceOwnerContext = SapportaAuthContext & {
  dataAuthority: RequestDataAuthority & {
    rowAuthorities: Pick<
      Required<RequestDataAuthority["rowAuthorities"]>,
      "workspaceGlobalOnly"
    >;
  };
};

export function requireWorkspaceOwner<E extends SapportaEnv>(
  c: Context<E>,
): AuthorizedWorkspaceOwnerContext {
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

export function requireDataAuthority<E extends SapportaEnv>(
  c: Context<E>,
): RequestDataAuthority {
  return requireAuthContext(c).dataAuthority;
}

export function requireAuthorizedSystemData<E extends SapportaEnv>(
  c: Context<E>,
  requirement: FeatureRequirement,
): AuthorizedSystemDataContext {
  const auth = requireAuthContext(c);
  if (!auth.dataAuthority.rowAuthorities.systemGlobalOnly) {
    throwAuth("forbidden");
  }
  forbidUnlessAuthorized(auth, requirement);
  return withOnlySystemAuthority(auth);
}

export function requireAuthorizedWorkspaceData<E extends SapportaEnv>(
  c: Context<E>,
  requirement: FeatureRequirement,
): AuthorizedWorkspaceDataContext {
  const auth = requireAuthContext(c);
  if (!auth.dataAuthority.rowAuthorities.workspaceGlobalOnly) {
    throwAuth("workspace_required");
  }
  forbidUnlessAuthorized(auth, requirement);
  return withOnlyWorkspaceAuthority(auth);
}

export function requireAuthorizedWorkspaceUserData<E extends SapportaEnv>(
  c: Context<E>,
  requirement: FeatureRequirement,
): AuthorizedWorkspaceUserDataContext {
  const auth = requireAuthContext(c);
  if (auth.principal.kind !== "user") throwAuth("unauthenticated");
  if (!auth.dataAuthority.rowAuthorities.workspaceUserScoped) {
    throwAuth("forbidden");
  }
  forbidUnlessAuthorized(auth, requirement);
  return withOnlyWorkspaceUserAuthority(auth);
}

export function requireAuthorizedInteractiveWorkspaceUserData<
  E extends SapportaEnv,
>(
  c: Context<E>,
  requirement: FeatureRequirement,
): AuthorizedWorkspaceUserDataContext {
  if (requestUsesBearerToken(c)) throwAuth("forbidden");
  return requireAuthorizedWorkspaceUserData(c, requirement);
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

function forbidUnlessAuthorized(
  auth: SapportaAuthContext,
  requirement: FeatureRequirement,
): void {
  if (auth.ability.can(requirement.action, requirement.subject)) return;
  throwAuth("forbidden");
}

function withOnlySystemAuthority(
  auth: SapportaAuthContext,
): AuthorizedSystemDataContext {
  const narrowed: SystemDataAuthority = {
    rowAuthorities: {
      systemGlobalOnly: auth.dataAuthority.rowAuthorities.systemGlobalOnly!,
    },
  };
  return {
    ...auth,
    dataAuthority: narrowed,
    rowSecurity: auth.rowSecurity.withDataAuthority(narrowed),
  } as AuthorizedSystemDataContext;
}

function withOnlyWorkspaceAuthority(
  auth: SapportaAuthContext,
): AuthorizedWorkspaceDataContext {
  const narrowed: WorkspaceDataAuthority = {
    rowAuthorities: {
      workspaceGlobalOnly:
        auth.dataAuthority.rowAuthorities.workspaceGlobalOnly!,
    },
  };
  return {
    ...auth,
    dataAuthority: narrowed,
    rowSecurity: auth.rowSecurity.withDataAuthority(narrowed),
  } as AuthorizedWorkspaceDataContext;
}

function withOnlyWorkspaceUserAuthority(
  auth: SapportaAuthContext,
): AuthorizedWorkspaceUserDataContext {
  const narrowed: WorkspaceUserDataAuthority = {
    rowAuthorities: {
      workspaceUserScoped:
        auth.dataAuthority.rowAuthorities.workspaceUserScoped!,
    },
  };
  return {
    ...auth,
    dataAuthority: narrowed,
    rowSecurity: auth.rowSecurity.withDataAuthority(narrowed),
  } as AuthorizedWorkspaceUserDataContext;
}

function requestUsesBearerToken<E extends SapportaEnv>(c: Context<E>): boolean {
  return c.req.header("authorization")?.match(/^Bearer\s+/i) !== undefined;
}

function throwAuth(code: Parameters<typeof authFailure>[0]): never {
  const failure = authFailure(code);
  throw new HTTPException(failure.status, {
    res: Response.json(failure.body, { status: failure.status }),
  });
}
