import {
  createRowSecurity,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaAuthIdentity,
  type TableCatalog,
} from "@sapporta/server";
import type { BetterAuthSessionApi } from "./better-auth.js";
import {
  ensureActiveWorkspace,
  sapportaRole,
  switchWorkspaceMembership,
  type WorkspaceMembershipRow,
} from "./workspace.js";

/** Minimal Better Auth session shape needed to build Sapporta auth context. */
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

/**
 * Resolves the current Better Auth session into Sapporta's request auth context.
 *
 * The loaded table catalog is required here so `rowSecurity` is fully ready for
 * domain handlers; no later middleware decorates or replaces the auth context.
 */
export async function resolveSapportaAuthContext(
  auth: BetterAuthSessionApi,
  conn: ProjectDbConnection,
  catalog: TableCatalog,
  headers: Headers,
): Promise<SapportaAuthContext | null> {
  const payload = await getSessionPayload(auth, headers);
  if (!payload) return null;
  const membership = ensureActiveWorkspace(conn, payload);
  return authContextFromPayload(payload, membership, catalog);
}

/**
 * Switches the active workspace after verifying membership, then returns a new
 * table-bound auth context for the same request.
 */
export async function switchActiveWorkspace(
  auth: BetterAuthSessionApi,
  conn: ProjectDbConnection,
  catalog: TableCatalog,
  headers: Headers,
  workspaceId: string,
): Promise<SapportaAuthContext> {
  const payload = await getSessionPayload(auth, headers);
  if (!payload) {
    throw new Error("You must sign in before switching workspaces.");
  }
  const membership = switchWorkspaceMembership(conn, payload, workspaceId);
  return authContextFromPayload(payload, membership, catalog);
}

/**
 * Converts Better Auth organization membership into Sapporta's auth model and
 * binds row security to the loaded table catalog.
 */
export function authContextFromPayload(
  payload: BetterAuthSessionPayload,
  membership: WorkspaceMembershipRow,
  catalog: TableCatalog,
): SapportaAuthContext {
  const role = sapportaRole(membership.role);
  const identity: SapportaAuthIdentity = {
    session: {
      id: payload.session.id,
      userId: payload.user.id,
      activeWorkspaceId: membership.organization_id,
    },
    user: {
      id: payload.user.id,
      name: payload.user.name ?? null,
      email: payload.user.email,
      emailVerified: payload.user.emailVerified,
    },
    workspace: {
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
      isOwner: role === "owner",
    },
    member: {
      id: membership.member_id,
      role,
    },
  };
  return {
    ...identity,
    rowSecurity: createRowSecurity(identity, { catalog }),
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
