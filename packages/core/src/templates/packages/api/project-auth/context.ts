import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  anonymousPrincipal,
  createAuthContext,
  userPrincipal,
  type BuildAbility,
  type RequestDataAuthority,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaAuthUser,
  type SapportaEnv,
  type TableCatalog,
} from "@sapporta/server";
import type {
  AppAbility,
  AppPrincipal,
  AppWorkspaceMembership,
} from "../authz/types.js";
import type { BetterAuthSessionApi } from "./better-auth.js";
import {
  ensureActiveWorkspace,
  membershipFromRow,
  switchWorkspaceMembership,
} from "./workspace.js";
import { authFailure } from "./errors.js";
import { resolveBearerTokenPrincipal, TokenAuthError } from "./auth-tokens.js";

/**
 * Decides which rows a request may touch.
 *
 * The request is required, not optional, and there is deliberately no second
 * resolver that does without it. An application that narrows or widens row
 * access per route needs the request, and a resolver that had to cope with its
 * absence would be a resolver where forgetting the absent case quietly changes
 * what a caller may read and write.
 */
export type ResolveRequestDataAuthority = (input: {
  principal: AppPrincipal;
  c: Context<SapportaEnv>;
}) => Promise<RequestDataAuthority>;

/**
 * Minimal Better Auth session shape needed to build the request principal.
 *
 * The session identifies the signed-in user. It does not decide row access by
 * itself; the app's data-authority resolver does that after the principal is
 * known.
 */
export interface BetterAuthSessionPayload {
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
  };
  user: {
    id: string;
    name?: string | null;
    email: string;
    emailVerified: boolean;
  };
}

export interface ResolveSapportaAuthContextInput {
  auth: BetterAuthSessionApi;
  conn: ProjectDbConnection;
  catalog: TableCatalog;
  headers: Headers;
  c: Context<SapportaEnv>;
  buildAbility: BuildAbility<AppAbility, AppWorkspaceMembership>;
  resolveRequestDataAuthority: ResolveRequestDataAuthority;
}

/**
 * Builds the auth context every API handler reads from `c.get("auth")`.
 *
 * A request can identify the user in two ways:
 * - an agent access token in `Authorization: Bearer ...`
 * - a browser session cookie from the app UI
 *
 * Bearer tokens are checked first because they explicitly name the workspace
 * for this request. If neither credential is present, the request is anonymous;
 * public routes can still run, while private routes reject it before reading
 * application data.
 */
export async function resolveSapportaAuthContext(
  input: ResolveSapportaAuthContextInput,
): Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>> {
  const principal = await resolvePrincipal(
    input.auth,
    input.conn,
    input.headers,
  );
  return authContextFrom({
    principal,
    dataAuthority: await input.resolveRequestDataAuthority({
      principal,
      c: input.c,
    }),
    buildAbility: input.buildAbility,
    catalog: input.catalog,
  });
}

/**
 * Assembles the auth context from facts that are already settled.
 *
 * Who the caller is and which rows they may touch are both decided before this
 * point, by whichever route the caller arrived on. This only puts those two
 * answers together, which is why it stays inside this file: every way of
 * getting here goes through one of the exported functions above.
 */
function authContextFrom(input: {
  principal: AppPrincipal;
  dataAuthority: RequestDataAuthority;
  buildAbility: BuildAbility<AppAbility, AppWorkspaceMembership>;
  catalog: TableCatalog;
}): SapportaAuthContext<AppAbility, AppWorkspaceMembership> {
  const { principal, dataAuthority } = input;
  return createAuthContext({
    principal,
    dataAuthority,
    ability: input.buildAbility({ principal, dataAuthority }),
    catalog: input.catalog,
  });
}

export async function switchActiveWorkspace(
  input: ResolveSapportaAuthContextInput & { workspaceId: string },
): Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>> {
  const payload = await getSessionPayload(input.auth, input.headers);
  if (!payload) {
    throw new Error("You must sign in before switching workspaces.");
  }
  const membership = switchWorkspaceMembership(
    input.conn,
    payload,
    input.workspaceId,
  );
  const principal = userPrincipal({
    user: userFromSessionPayload(payload),
    membership: membershipFromRow(membership),
  });
  return authContextFrom({
    principal,
    dataAuthority: await input.resolveRequestDataAuthority({
      principal,
      c: input.c,
    }),
    buildAbility: input.buildAbility,
    catalog: input.catalog,
  });
}

export async function resolvePrincipal(
  auth: BetterAuthSessionApi,
  conn: ProjectDbConnection,
  headers: Headers,
): Promise<AppPrincipal> {
  try {
    const bearerPrincipal = resolveBearerTokenPrincipal(conn, headers);
    if (bearerPrincipal) return bearerPrincipal;
  } catch (err) {
    if (err instanceof TokenAuthError) {
      const failure = authFailure(err.code);
      throw new HTTPException(failure.status, {
        res: Response.json(failure.body, { status: failure.status }),
      });
    }
    throw err;
  }

  const payload = await getSessionPayload(auth, headers);
  if (!payload) return anonymousPrincipal();
  const membership = ensureActiveWorkspace(conn, payload);
  return userPrincipal({
    user: userFromSessionPayload(payload),
    membership: membershipFromRow(membership),
  });
}

export function userFromSessionPayload(
  payload: BetterAuthSessionPayload,
): SapportaAuthUser {
  return {
    id: payload.user.id,
    name: payload.user.name ?? null,
    email: payload.user.email,
    emailVerified: payload.user.emailVerified,
  };
}

async function getSessionPayload(
  auth: BetterAuthSessionApi,
  headers: Headers,
): Promise<BetterAuthSessionPayload | null> {
  const session = await auth.getSession({
    headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  return isSessionPayload(session) ? session : null;
}

function isSessionPayload(value: unknown): value is BetterAuthSessionPayload {
  if (!isRecord(value)) return false;
  const session = value.session;
  const user = value.user;
  return (
    isRecord(session) &&
    isRecord(user) &&
    typeof session.id === "string" &&
    typeof session.userId === "string" &&
    (session.activeOrganizationId === undefined ||
      session.activeOrganizationId === null ||
      typeof session.activeOrganizationId === "string") &&
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.emailVerified === "boolean" &&
    (user.name === undefined ||
      user.name === null ||
      typeof user.name === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
