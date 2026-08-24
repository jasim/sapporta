import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  userPrincipal,
  type ProjectDbConnection,
  type SapportaAuthUser,
} from "@sapporta/server";
import type {
  AuthToken,
  CreateAuthTokenBody,
  CreateAuthTokenResponse,
} from "@sapporta/shared/contracts";
import type { AppPrincipal, AppWorkspaceMembership } from "../authz/types.js";
import type { ProjectAuthErrorCode } from "./errors.js";
import { findUserById } from "./user.js";
import { findMembership, membershipFromRow } from "./workspace.js";

/**
 * Agent access tokens let non-browser clients call the same protected API that
 * a signed-in user can call from the app UI.
 *
 * One token belongs to one user and one workspace in this database. The CLI
 * does not send a workspace id for ordinary data commands; the token selects
 * the workspace. Store only the raw token in a secret manager or agent
 * environment. The database stores a hash of the secret and never returns the
 * raw token again after creation.
 */
const TOKEN_PREFIX = "spat";

interface PersonalAccessTokenRow {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  secret_hash: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

export class TokenAuthError extends Error {
  constructor(readonly code: ProjectAuthErrorCode) {
    super(code);
  }
}

export class TokenManagementError extends Error {
  constructor(readonly code: ProjectAuthErrorCode) {
    super(code);
  }
}

export interface AuthTokenManagementScope {
  userId: string;
  organizationId: string;
}

/**
 * Resolve `Authorization: Bearer spat_<tokenId>_<secret>` into the same user
 * principal shape used by browser sessions.
 *
 * Token failures are intentionally specific enough for automation to recover:
 * expired and revoked tokens can prompt rotation, while `workspace_required`
 * means the user no longer belongs to the workspace named by the token.
 * `lastUsedAt` is updated only after every token, user, and membership check
 * succeeds.
 */
export function resolveBearerTokenPrincipal(
  conn: ProjectDbConnection,
  headers: Headers,
): AppPrincipal | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;

  const parsed = parseBearerToken(authorization);
  if (!parsed) throw new TokenAuthError("unauthenticated");

  const token = readToken(conn, parsed.id);
  if (!token) throw new TokenAuthError("unauthenticated");
  if (!safeEqual(token.secret_hash, hashSecret(parsed.id, parsed.secret))) {
    throw new TokenAuthError("unauthenticated");
  }
  if (token.revoked_at !== null) throw new TokenAuthError("token_revoked");
  if (token.expires_at !== null && token.expires_at <= Date.now()) {
    throw new TokenAuthError("token_expired");
  }

  const user = findUserById(conn, token.user_id);
  if (!user) throw new TokenAuthError("unauthenticated");
  const membership = findMembership(conn, token.user_id, token.organization_id);
  if (!membership) throw new TokenAuthError("workspace_required");

  markTokenUsed(conn, token.id);
  return userPrincipal({
    user,
    membership: membershipFromRow(membership),
  });
}

export function listAuthTokens(
  conn: ProjectDbConnection,
  userId: string,
  organizationId?: string,
): AuthToken[] {
  if (organizationId) {
    return conn.sqlite
      .prepare(
        `
      SELECT
        id,
        userId AS user_id,
        organizationId AS organization_id,
        name,
        secretHash AS secret_hash,
        createdAt AS created_at,
        expiresAt AS expires_at,
        lastUsedAt AS last_used_at,
        revokedAt AS revoked_at
      FROM personalAccessToken
      WHERE userId = ? AND organizationId = ?
      ORDER BY createdAt DESC, id ASC
      `,
      )
      .all(userId, organizationId)
      .map(readTokenRow)
      .filter((row): row is PersonalAccessTokenRow => row !== null)
      .map(serializeToken);
  }

  return conn.sqlite
    .prepare(
      `
      SELECT
        id,
        userId AS user_id,
        organizationId AS organization_id,
        name,
        secretHash AS secret_hash,
        createdAt AS created_at,
        expiresAt AS expires_at,
        lastUsedAt AS last_used_at,
        revokedAt AS revoked_at
      FROM personalAccessToken
      WHERE userId = ?
      ORDER BY createdAt DESC, id ASC
      `,
    )
    .all(userId)
    .map(readTokenRow)
    .filter((row): row is PersonalAccessTokenRow => row !== null)
    .map(serializeToken);
}

/**
 * Create a workspace-scoped token for the signed-in user.
 *
 * Token-management routes pass the current workspace scope. If the request
 * names another workspace, creation is rejected instead of switching scope.
 * The response includes `rawToken` once so the user can copy it into
 * `SAPPORTA_API_TOKEN`; later list calls return metadata only.
 */
export function createAuthToken(
  conn: ProjectDbConnection,
  principal: Extract<AppPrincipal, { kind: "user" }>,
  body: CreateAuthTokenBody,
  scope?: AuthTokenManagementScope,
): CreateAuthTokenResponse {
  if (scope && scope.userId !== principal.user.id) {
    throw new TokenManagementError("forbidden");
  }
  if (
    scope &&
    body.organizationId !== undefined &&
    body.organizationId !== scope.organizationId
  ) {
    throw new TokenManagementError("forbidden");
  }
  const organizationId =
    scope?.organizationId ??
    body.organizationId ??
    principal.membership.workspace.id;
  const membership = findMembership(conn, principal.user.id, organizationId);
  if (!membership) throw new TokenManagementError("forbidden");

  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = parseOptionalDate(body.expiresAt);

  conn.sqlite
    .prepare(
      `
      INSERT INTO personalAccessToken (
        id,
        userId,
        organizationId,
        name,
        secretHash,
        createdAt,
        expiresAt,
        lastUsedAt,
        revokedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `,
    )
    .run(
      id,
      principal.user.id,
      membership.organization_id,
      body.name,
      hashSecret(id, secret),
      now,
      expiresAt,
    );

  const token = readToken(conn, id);
  if (!token) {
    throw new Error("Created agent access token could not be read.");
  }
  return {
    token: serializeToken(token),
    rawToken: `${TOKEN_PREFIX}_${id}_${secret}`,
  };
}

export function revokeAuthToken(
  conn: ProjectDbConnection,
  userId: string,
  tokenId: string,
  organizationId?: string,
): boolean {
  if (organizationId) {
    const result = conn.sqlite
      .prepare(
        `
        UPDATE personalAccessToken
        SET revokedAt = ?
        WHERE id = ? AND userId = ? AND organizationId = ? AND revokedAt IS NULL
        `,
      )
      .run(Date.now(), tokenId, userId, organizationId);
    return result.changes > 0;
  }

  const result = conn.sqlite
    .prepare(
      `
      UPDATE personalAccessToken
      SET revokedAt = ?
      WHERE id = ? AND userId = ? AND revokedAt IS NULL
      `,
    )
    .run(Date.now(), tokenId, userId);
  return result.changes > 0;
}

/**
 * Token ids are public lookup handles; token secrets are the bearer
 * credentials. Splitting the two lets the server find one row and compare a
 * hash without storing the raw credential.
 */
function parseBearerToken(
  value: string,
): { id: string; secret: string } | null {
  const match = value.match(/^Bearer\s+spat_([^_]+)_(.+)$/i);
  if (!match) return null;
  return {
    id: match[1],
    secret: match[2],
  };
}

function hashSecret(id: string, secret: string): string {
  return createHash("sha256").update(`${id}:${secret}`).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readToken(
  conn: ProjectDbConnection,
  id: string,
): PersonalAccessTokenRow | null {
  return readTokenRow(
    conn.sqlite
      .prepare(
        `
        SELECT
          id,
          userId AS user_id,
          organizationId AS organization_id,
          name,
          secretHash AS secret_hash,
          createdAt AS created_at,
          expiresAt AS expires_at,
          lastUsedAt AS last_used_at,
          revokedAt AS revoked_at
        FROM personalAccessToken
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id),
  );
}

function markTokenUsed(conn: ProjectDbConnection, id: string): void {
  conn.sqlite
    .prepare("UPDATE personalAccessToken SET lastUsedAt = ? WHERE id = ?")
    .run(Date.now(), id);
}

function serializeToken(row: PersonalAccessTokenRow): AuthToken {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    name: row.name,
    createdAt: toIso(row.created_at),
    expiresAt: toNullableIso(row.expires_at),
    lastUsedAt: toNullableIso(row.last_used_at),
    revokedAt: toNullableIso(row.revoked_at),
  };
}

function parseOptionalDate(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  return new Date(value).getTime();
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function toNullableIso(value: number | null): string | null {
  return value === null ? null : toIso(value);
}

function readTokenRow(row: unknown): PersonalAccessTokenRow | null {
  if (!isRecord(row)) return null;
  const id = readString(row, "id");
  const userId = readString(row, "user_id");
  const organizationId = readString(row, "organization_id");
  const name = readString(row, "name");
  const secretHash = readString(row, "secret_hash");
  const createdAt = readNumber(row, "created_at");
  if (
    !id ||
    !userId ||
    !organizationId ||
    !name ||
    !secretHash ||
    createdAt === null
  ) {
    return null;
  }
  return {
    id,
    user_id: userId,
    organization_id: organizationId,
    name,
    secret_hash: secretHash,
    created_at: createdAt,
    expires_at: readNullableNumber(row, "expires_at"),
    last_used_at: readNullableNumber(row, "last_used_at"),
    revoked_at: readNullableNumber(row, "revoked_at"),
  };
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : null;
}

function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function readNullableNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key];
  return value === null || value === undefined
    ? null
    : typeof value === "number"
      ? value
      : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
