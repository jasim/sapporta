import { z } from "zod";

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
