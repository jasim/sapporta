import { randomUUID } from "node:crypto";
import type { ProjectDbConnection } from "@sapporta/server";
import type { BetterAuthSessionPayload } from "./context.js";

export interface WorkspaceMembershipRow {
  member_id: string;
  role: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
}

export class WorkspaceSwitchError extends Error {
  readonly code = "forbidden";
  readonly status = 403;
}

/**
 * The account facts a workspace is named and owned by.
 *
 * A workspace belongs to a person, not to one of their browser sessions, so
 * this is deliberately not the session payload: a command-line script knows
 * the account it signed in as without holding a session for it.
 */
export interface WorkspaceOwner {
  id: string;
  name?: string | null;
  email: string;
}

/**
 * Returns the workspace this person joined first, creating one if they have
 * joined none yet.
 *
 * This answers from stored facts alone, with no session to consult, which is
 * what a command-line script has. `ensureActiveWorkspace()` below prefers
 * whichever workspace the session is already in and falls back to this, so the
 * two agree for a person with one workspace and for a session that has not
 * chosen one. They part company for a person who has more than one and has
 * switched: the browser stays where it was, and a script still writes here.
 */
export function ensureWorkspaceMembership(
  conn: ProjectDbConnection,
  owner: WorkspaceOwner,
): WorkspaceMembershipRow {
  const existing = findFirstMembership(conn, owner.id);
  if (existing) return existing;
  // The workspace and the membership of it are written together, so a failure
  // part way through leaves behind no workspace nobody belongs to.
  return conn.sqlite.transaction(() => createInitialWorkspace(conn, owner))();
}

/**
 * Returns the workspace this request is working in and remembers it on the
 * session.
 *
 * A session that already names a workspace keeps it, as long as the person is
 * still a member. Otherwise the workspace is the one they work in anyway, and
 * it becomes the session's active one so the next request does not look again.
 */
export function ensureActiveWorkspace(
  conn: ProjectDbConnection,
  payload: BetterAuthSessionPayload,
): WorkspaceMembershipRow {
  const activeWorkspaceId = payload.session.activeOrganizationId ?? null;
  if (activeWorkspaceId) {
    const membership = findMembership(conn, payload.user.id, activeWorkspaceId);
    if (membership) return membership;
  }

  const membership = ensureWorkspaceMembership(conn, payload.user);
  setActiveWorkspace(conn, payload.session.id, membership.organization_id);
  payload.session.activeOrganizationId = membership.organization_id;
  return membership;
}

export function switchWorkspaceMembership(
  conn: ProjectDbConnection,
  payload: BetterAuthSessionPayload,
  workspaceId: string,
): WorkspaceMembershipRow {
  const membership = findMembership(conn, payload.user.id, workspaceId);
  if (!membership) {
    throw new WorkspaceSwitchError("You are not a member of that workspace.");
  }
  setActiveWorkspace(conn, payload.session.id, workspaceId);
  payload.session.activeOrganizationId = workspaceId;
  return membership;
}

export function findMembership(
  conn: ProjectDbConnection,
  userId: string,
  organizationId: string,
): WorkspaceMembershipRow | null {
  return readMembership(
    conn.sqlite
      .prepare(
        `
        SELECT
          member.id AS member_id,
          member.role AS role,
          organization.id AS organization_id,
          organization.name AS organization_name,
          organization.slug AS organization_slug
        FROM member
        INNER JOIN organization ON organization.id = member.organizationId
        WHERE member.userId = ? AND member.organizationId = ?
        LIMIT 1
        `,
      )
      .get(userId, organizationId),
  );
}

/**
 * The workspace this person joined first, or null when they have joined none.
 *
 * This reads; it never creates. `ensureWorkspaceMembership()` above is the one
 * that provisions a first workspace.
 */
export function findFirstMembership(
  conn: ProjectDbConnection,
  userId: string,
): WorkspaceMembershipRow | null {
  return readMembership(
    conn.sqlite
      .prepare(
        `
        SELECT
          member.id AS member_id,
          member.role AS role,
          organization.id AS organization_id,
          organization.name AS organization_name,
          organization.slug AS organization_slug
        FROM member
        INNER JOIN organization ON organization.id = member.organizationId
        WHERE member.userId = ?
        ORDER BY member.createdAt ASC, member.id ASC
        LIMIT 1
        `,
      )
      .get(userId),
  );
}

export function createInitialWorkspace(
  conn: ProjectDbConnection,
  owner: WorkspaceOwner,
): WorkspaceMembershipRow {
  const now = unixTimestamp();
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const name = workspaceName(owner);
  const slug = uniqueWorkspaceSlug(conn, name);

  conn.sqlite
    .prepare(
      `
      INSERT INTO organization (id, name, slug, logo, createdAt, metadata)
      VALUES (?, ?, ?, NULL, ?, NULL)
      `,
    )
    .run(organizationId, name, slug, now);
  conn.sqlite
    .prepare(
      `
      INSERT INTO member (id, organizationId, userId, role, createdAt)
      VALUES (?, ?, ?, 'owner', ?)
      `,
    )
    .run(memberId, organizationId, owner.id, now);

  return {
    member_id: memberId,
    role: "owner",
    organization_id: organizationId,
    organization_name: name,
    organization_slug: slug,
  };
}

export function setActiveWorkspace(
  conn: ProjectDbConnection,
  sessionId: string,
  workspaceId: string,
): void {
  conn.sqlite
    .prepare(
      `
      UPDATE session
      SET activeOrganizationId = ?, updatedAt = ?
      WHERE id = ?
      `,
    )
    .run(workspaceId, unixTimestamp(), sessionId);
}

function uniqueWorkspaceSlug(conn: ProjectDbConnection, name: string): string {
  const base = slugify(name) || "workspace";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const candidate = `${base}${suffix}`;
    if (!workspaceSlugExists(conn, candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function workspaceSlugExists(conn: ProjectDbConnection, slug: string): boolean {
  const row = conn.sqlite
    .prepare("SELECT 1 AS found FROM organization WHERE slug = ? LIMIT 1")
    .get(slug);
  return row !== undefined;
}

function workspaceName(owner: WorkspaceOwner): string {
  const trimmedName = owner.name?.trim();
  if (trimmedName) return `${trimmedName}'s Workspace`;
  return `${owner.email.split("@")[0]}'s Workspace`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function readMembership(row: unknown): WorkspaceMembershipRow | null {
  if (!isRecord(row)) return null;
  const memberId = readString(row, "member_id");
  const role = readString(row, "role");
  const organizationId = readString(row, "organization_id");
  const organizationName = readString(row, "organization_name");
  const organizationSlug = readString(row, "organization_slug");
  if (
    !memberId ||
    !role ||
    !organizationId ||
    !organizationName ||
    !organizationSlug
  ) {
    return null;
  }
  return {
    member_id: memberId,
    role,
    organization_id: organizationId,
    organization_name: organizationName,
    organization_slug: organizationSlug,
  };
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
