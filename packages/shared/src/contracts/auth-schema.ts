import { z } from "zod";

/**
 * Auth and workspace shapes returned to the browser UI.
 *
 * A request has one active workspace. Roles describe the user's membership in
 * that workspace; a user may have a different role in another workspace.
 */
export const authRoleSchema = z.enum(["owner", "member"]).meta({ id: "AuthRole" });
export type AuthRole = z.output<typeof authRoleSchema>;

export const authCurrentUserSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    emailVerified: z.boolean(),
  })
  .meta({ id: "AuthCurrentUser" });
export type AuthCurrentUser = z.output<typeof authCurrentUserSchema>;

export const authWorkspaceSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .meta({ id: "AuthWorkspaceSummary" });
export type AuthWorkspaceSummary = z.output<typeof authWorkspaceSummarySchema>;

export const authActiveWorkspaceSchema = authWorkspaceSummarySchema
  .extend({
    isOwner: z.boolean(),
  })
  .meta({ id: "AuthActiveWorkspace" });
export type AuthActiveWorkspace = z.output<typeof authActiveWorkspaceSchema>;

export const authMembershipSchema = z
  .object({
    id: z.string(),
    workspace: authWorkspaceSummarySchema,
    role: authRoleSchema,
    isOwner: z.boolean(),
  })
  .meta({ id: "AuthMembership" });
export type AuthMembership = z.output<typeof authMembershipSchema>;

export const authContextResponseSchema = z
  .object({
    user: authCurrentUserSchema,
    workspace: authActiveWorkspaceSchema,
    memberships: z.array(authMembershipSchema),
    role: authRoleSchema,
    isOwner: z.boolean(),
  })
  .meta({ id: "AuthContextResponse" });
export type AuthContextResponse = z.output<typeof authContextResponseSchema>;

export const authBootstrapStatusSchema = z
  .object({
    userCount: z.number().int().nonnegative(),
    workspaceCount: z.number().int().nonnegative(),
    isEmpty: z.boolean(),
  })
  .meta({ id: "AuthBootstrapStatus" });
export type AuthBootstrapStatus = z.output<typeof authBootstrapStatusSchema>;

export const switchActiveWorkspaceBodySchema = z
  .object({
    workspaceId: z.string(),
  })
  .meta({ id: "SwitchActiveWorkspaceBody" });
export type SwitchActiveWorkspaceBody = z.output<typeof switchActiveWorkspaceBodySchema>;

/**
 * Metadata for an agent access token.
 *
 * Token lists intentionally expose only metadata. They never include
 * `secretHash` and never include the raw bearer token. The raw token is present
 * only in the create response so the user can copy it once.
 */
export const authTokenSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    name: z.string(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .meta({ id: "AuthToken" });
export type AuthToken = z.output<typeof authTokenSchema>;

export const authTokenListResponseSchema = z
  .object({
    tokens: z.array(authTokenSchema),
  })
  .meta({ id: "AuthTokenListResponse" });
export type AuthTokenListResponse = z.output<typeof authTokenListResponseSchema>;

export const createAuthTokenBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    organizationId: z.string().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .meta({ id: "CreateAuthTokenBody" });
export type CreateAuthTokenBody = z.output<typeof createAuthTokenBodySchema>;

/**
 * Creation returns both metadata and the one-time bearer token.
 *
 * Store `rawToken` in an agent environment or secret manager as
 * `SAPPORTA_API_TOKEN`. It cannot be recovered from later list responses.
 */
export const createAuthTokenResponseSchema = z
  .object({
    token: authTokenSchema,
    rawToken: z.string(),
  })
  .meta({ id: "CreateAuthTokenResponse" });
export type CreateAuthTokenResponse = z.output<typeof createAuthTokenResponseSchema>;
