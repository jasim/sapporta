import type { Context } from "hono";
import {
  anonymousPrincipal,
  createAuthContext,
  userPrincipal,
  type BuildAbility,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaAuthUser,
  type SapportaEnv,
  type TableCatalog,
} from "@sapporta/server";
import type { AppAbility, AppPrincipal, AppWorkspaceMembership } from "../authz/types.js";
import type { BetterAuthSessionApi } from "./better-auth.js";
import {
  ensureActiveWorkspace,
  switchWorkspaceMembership,
  type WorkspaceMembershipRow,
} from "./workspace.js";

export type ResolveRowsAllowedForRequest = (input: {
  principal: AppPrincipal;
  c: Context<SapportaEnv>;
}) => Promise<
  SapportaAuthContext<
    AppAbility,
    AppWorkspaceMembership
  >["rowsAllowedForRequest"]
>;

/**
 * Minimal Better Auth session shape needed to build the request principal.
 *
 * The session identifies the signed-in user. It does not decide row access by
 * itself; the app's rows-allowed resolver does that after the principal is
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
  resolveRowsAllowedForRequest: ResolveRowsAllowedForRequest;
}

/**
 * Builds the auth context that every API route reads from `c.get("auth")`.
 *
 * No-session requests still receive an anonymous principal and a real ability.
 * The anonymous gate decides whether that request may reach a route, and the
 * route still performs its own CASL check.
 */
export async function resolveSapportaAuthContext(
  input: ResolveSapportaAuthContextInput,
): Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>> {
  const principal = await resolvePrincipal(input.auth, input.conn, input.headers);
  const rowsAllowedForRequest = await input.resolveRowsAllowedForRequest({
    principal,
    c: input.c,
  });
  const ability = input.buildAbility({ principal, rowsAllowedForRequest });
  return createAuthContext({
    principal,
    rowsAllowedForRequest,
    ability,
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
  const rowsAllowedForRequest = await input.resolveRowsAllowedForRequest({
    principal,
    c: input.c,
  });
  const ability = input.buildAbility({ principal, rowsAllowedForRequest });
  return createAuthContext({
    principal,
    rowsAllowedForRequest,
    ability,
    catalog: input.catalog,
  });
}

export async function resolvePrincipal(
  auth: BetterAuthSessionApi,
  conn: ProjectDbConnection,
  headers: Headers,
): Promise<AppPrincipal> {
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

/**
 * Converts the active workspace membership row into the app-facing membership
 * facts. Role is resolved on the membership, not on the user, so the same user
 * can have different roles in different workspaces.
 */
export function membershipFromRow(
  row: WorkspaceMembershipRow,
): AppWorkspaceMembership {
  const role = row.role === "owner" || row.role === "admin" ? "owner" : "member";
  return {
    id: row.member_id,
    workspace: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
    },
    roles: [role],
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
