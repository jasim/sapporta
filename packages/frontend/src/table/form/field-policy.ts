import type { ColumnSchema } from "@sapporta/shared/contracts";
import { isSystemManagedScopeFieldName } from "@sapporta/shared/row-scope";

export function isRecordFormEditableColumn(column: ColumnSchema): boolean {
  if (column.visuallyHidden) return false;
  if (column.primary && column.hasDefault) return false;
  if (column.clientEditable === false) return false;
  if (isSystemManagedScopeFieldName(column.name)) return false;
  return true;
}
