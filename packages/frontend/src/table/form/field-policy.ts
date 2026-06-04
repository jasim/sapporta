import type { ColumnSchema } from "@sapporta/shared/contracts";

export const SYSTEM_MANAGED_SCOPE_FIELD_NAMES = [
  "workspace_id",
  "workspaceId",
  "scoped_to_user_id",
  "scopedToUserId",
] as const;

const SYSTEM_MANAGED_SCOPE_FIELDS = new Set<string>(SYSTEM_MANAGED_SCOPE_FIELD_NAMES);

export function isSystemManagedScopeField(name: string): boolean {
  return SYSTEM_MANAGED_SCOPE_FIELDS.has(name);
}

export function isRecordFormEditableColumn(column: ColumnSchema): boolean {
  if (column.visuallyHidden) return false;
  if (column.primary && column.hasDefault) return false;
  if (column.clientEditable === false) return false;
  if (isSystemManagedScopeField(column.name)) return false;
  return true;
}
