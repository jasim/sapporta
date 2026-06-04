import { createTableCatalog } from "../schema/catalog.js";
import type { TableDef } from "../schema/table.js";
import {
  createRowSecurity,
  type SapportaAuthContext,
  type SapportaAuthIdentity,
} from "../auth/index.js";

export interface TestAuthContextOptions {
  userId?: string;
  workspaceId?: string;
  isOwner?: boolean;
  tables?: readonly TableDef[];
}

export function createTestAuthContext(
  options: TestAuthContextOptions = {},
): SapportaAuthContext {
  const userId = options.userId ?? "user-1";
  const workspaceId = options.workspaceId ?? "workspace-1";
  const role = options.isOwner ? "owner" : "user";
  const identity: SapportaAuthIdentity = {
    session: {
      id: `session-${userId}`,
      userId,
      activeWorkspaceId: workspaceId,
    },
    user: {
      id: userId,
      name: "Test User",
      email: `${userId}@example.com`,
      emailVerified: true,
    },
    workspace: {
      id: workspaceId,
      name: "Test Workspace",
      slug: workspaceId,
      isOwner: options.isOwner ?? false,
    },
    member: {
      id: `member-${userId}`,
      role,
    },
  };

  return {
    ...identity,
    rowSecurity: createRowSecurity(identity, {
      catalog: createTableCatalog(options.tables ?? []),
    }),
  };
}
