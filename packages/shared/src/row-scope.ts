export const scopeColumnNames = {
  typescript: {
    workspaceId: "workspaceId",
    scopedToUserId: "scopedToUserId",
  },
  sql: {
    workspaceId: "workspace_id",
    scopedToUserId: "scoped_to_user_id",
  },
} as const;

export const WORKSPACE_ID_TS_COLUMN = scopeColumnNames.typescript.workspaceId;
export const SCOPED_TO_USER_ID_TS_COLUMN =
  scopeColumnNames.typescript.scopedToUserId;
export const WORKSPACE_ID_SQL_COLUMN = scopeColumnNames.sql.workspaceId;
export const SCOPED_TO_USER_ID_SQL_COLUMN = scopeColumnNames.sql.scopedToUserId;

const SYSTEM_MANAGED_SCOPE_FIELD_NAMES = [
  WORKSPACE_ID_SQL_COLUMN,
  WORKSPACE_ID_TS_COLUMN,
  SCOPED_TO_USER_ID_SQL_COLUMN,
  SCOPED_TO_USER_ID_TS_COLUMN,
] as const;

const SYSTEM_MANAGED_SCOPE_FIELDS = new Set<string>(
  SYSTEM_MANAGED_SCOPE_FIELD_NAMES,
);

export function systemManagedScopeFieldNames(): readonly string[] {
  return SYSTEM_MANAGED_SCOPE_FIELD_NAMES;
}

export function isSystemManagedScopeFieldName(name: string): boolean {
  return SYSTEM_MANAGED_SCOPE_FIELDS.has(name);
}
