import type { TableDef } from "../schema/table.js";
import type { AuthWorkspace, SapportaAuthUser } from "./principal.js";
import type { RowScope } from "./row-scope.js";

export type AtLeastOne<T> = {
  [K in keyof T]: Pick<T, K> & Partial<T>;
}[keyof T];

export interface SystemGlobalOnlyAuthority {
  kind: "systemGlobalOnly";
}

export interface WorkspaceGlobalOnlyAuthority {
  kind: "workspaceGlobalOnly";
  workspace: AuthWorkspace;
}

export interface WorkspaceUserScopedAuthority {
  kind: "workspaceUserScoped";
  workspace: AuthWorkspace;
  user: SapportaAuthUser;
}

export interface AuthoritySlots {
  systemGlobalOnly: SystemGlobalOnlyAuthority;
  workspaceGlobalOnly: WorkspaceGlobalOnlyAuthority;
  workspaceUserScoped: WorkspaceUserScopedAuthority;
}

export type RequestRowAuthorityRecord = AtLeastOne<AuthoritySlots>;

/**
 * Trusted ownership authority available to one request.
 *
 * This is not a permission grant. CASL decides whether the principal may run a
 * feature action; data authority tells Sapporta which trusted ownership facts
 * it may use for row predicates, insert stamping, payload restrictions, and
 * reference checks.
 */
export interface RequestDataAuthority {
  rowAuthorities: RequestRowAuthorityRecord;
}

export type WorkspaceGlobalDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    workspaceGlobalOnly: WorkspaceGlobalOnlyAuthority;
    systemGlobalOnly?: never;
    workspaceUserScoped?: never;
  };
};

export type WorkspaceUserDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    workspaceUserScoped: WorkspaceUserScopedAuthority;
    systemGlobalOnly?: never;
    workspaceGlobalOnly?: never;
  };
};

export type SystemGlobalDataAuthority = RequestDataAuthority & {
  rowAuthorities: {
    systemGlobalOnly: SystemGlobalOnlyAuthority;
    workspaceGlobalOnly?: never;
    workspaceUserScoped?: never;
  };
};

export function systemGlobalOnlyAuthority(): SystemGlobalOnlyAuthority {
  return { kind: "systemGlobalOnly" };
}

export function workspaceGlobalOnlyAuthority(
  workspace: AuthWorkspace,
): WorkspaceGlobalOnlyAuthority {
  return { kind: "workspaceGlobalOnly", workspace };
}

export function workspaceUserScopedAuthority(input: {
  workspace: AuthWorkspace;
  user: SapportaAuthUser;
}): WorkspaceUserScopedAuthority {
  return {
    kind: "workspaceUserScoped",
    workspace: input.workspace,
    user: input.user,
  };
}

export function requestDataAuthority(
  rowAuthorities: RequestRowAuthorityRecord,
): RequestDataAuthority {
  const workspaceIds = [
    rowAuthorities.workspaceGlobalOnly?.workspace.id,
    rowAuthorities.workspaceUserScoped?.workspace.id,
  ].filter((id): id is string => id !== undefined);
  if (new Set(workspaceIds).size > 1) {
    throw new Error(
      "Request data authority contains conflicting workspace ids.",
    );
  }
  return { rowAuthorities };
}

export function authorityNames(authority: RequestDataAuthority): string[] {
  return Object.keys(authority.rowAuthorities).filter(
    (key) =>
      authority.rowAuthorities[key as keyof RequestRowAuthorityRecord] !==
      undefined,
  );
}

export function rowAuthorityForScope(
  authority: RequestDataAuthority,
  rowScope: RowScope,
):
  | SystemGlobalOnlyAuthority
  | WorkspaceGlobalOnlyAuthority
  | WorkspaceUserScopedAuthority
  | undefined {
  if (rowScope === "systemGlobal") {
    return authority.rowAuthorities.systemGlobalOnly;
  }
  if (rowScope === "workspaceGlobal") {
    return authority.rowAuthorities.workspaceGlobalOnly;
  }
  return authority.rowAuthorities.workspaceUserScoped;
}

export function assertDataAuthoritySupportsTable(
  authority: RequestDataAuthority,
  table: TableDef,
): void {
  const rowScope = table.meta.rowScope;
  if (
    rowScope !== "systemGlobal" &&
    rowScope !== "workspaceGlobal" &&
    rowScope !== "workspaceUserScoped"
  ) {
    return;
  }
  if (!rowAuthorityForScope(authority, rowScope)) {
    throw new Error(
      `Request data authority [${authorityNames(authority).join(", ")}] cannot support ${rowScope} rows.`,
    );
  }
}
