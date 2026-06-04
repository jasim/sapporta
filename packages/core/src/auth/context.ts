import type { RowSecurity } from "./row-security.js";

export type SapportaAuthRole = "owner" | "user";

export const sapportaAuthRoles = ["owner", "user"] as const satisfies readonly SapportaAuthRole[];

export interface SapportaAuthSession {
  id: string;
  userId: string;
  activeWorkspaceId: string;
}

export interface SapportaAuthUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
}

export interface SapportaAuthWorkspace {
  id: string;
  name: string;
  slug: string;
  isOwner: boolean;
}

export interface SapportaAuthMember {
  id: string;
  role: SapportaAuthRole;
}

export interface SapportaAuthIdentity {
  session: SapportaAuthSession;
  user: SapportaAuthUser;
  workspace: SapportaAuthWorkspace;
  member: SapportaAuthMember;
}

export interface SapportaAuthContext extends SapportaAuthIdentity {
  rowSecurity: RowSecurity;
}

export function ownsActiveWorkspace(auth: SapportaAuthIdentity): boolean {
  return auth.workspace.isOwner;
}
