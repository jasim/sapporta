import { parseTimeZone } from "@sapporta/shared/temporal";
import { createTableCatalog } from "../schema/catalog.js";
import type { TableDef } from "../schema/table.js";
import {
  createAuthContext,
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  type SapportaAuthContext,
  type SapportaAbility,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
} from "../auth/index.js";

export interface TestAuthContextOptions {
  userId?: string;
  workspaceId?: string;
  isOwner?: boolean;
  tables?: readonly TableDef[];
  /**
   * The calendar the test workspace keeps, as an IANA id. Defaults to `UTC`;
   * name a zone with an offset to check that a handler reads days in the
   * workspace's calendar rather than the machine's.
   */
  timeZone?: string;
}

export function createTestAuthContext(
  options: TestAuthContextOptions = {},
): SapportaAuthContext {
  const userId = options.userId ?? "user-1";
  const workspaceId = options.workspaceId ?? "workspace-1";
  const workspace = {
    id: workspaceId,
    name: "Test Workspace",
    slug: workspaceId,
    timeZone: parseTimeZone(options.timeZone ?? "UTC"),
  };
  const user = {
    id: userId,
    name: "Test User",
    email: `${userId}@example.com`,
    emailVerified: true,
  };
  return createAuthContext({
    principal: {
      kind: "user",
      user,
      membership: {
        id: `member-${userId}`,
        roles: [options.isOwner ? "owner" : "member"],
      },
    },
    dataAuthority: requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
      workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
      workspaceUserScoped: workspaceUserScopedAuthority({
        workspace,
        user,
      }),
    }),
    ability: allowAllAbility(),
    catalog: createTableCatalog(options.tables ?? []),
  });
}

function allowAllAbility(): SapportaAbility {
  return { can: () => true };
}
