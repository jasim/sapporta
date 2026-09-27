/**
 * Projects server-emitted write and presentation facts into create-form fields.
 *
 * This policy keeps generated forms consistent with the table API shape. It is
 * not enforcement: callers can bypass the UI, so backend auth independently
 * rejects server-owned fields before the save pipeline validates values.
 */

import type { ColumnSchema } from "@sapporta/shared/contracts";
import { isSystemManagedScopeFieldName } from "@sapporta/shared/row-scope";

export function isRecordFormEditableColumn(column: ColumnSchema): boolean {
  if (column.visuallyHidden) return false;
  if (column.primary && column.hasDefault) return false;
  if (column.apiWritable === false) return false;
  if (isSystemManagedScopeFieldName(column.name)) return false;
  return true;
}

/**
 * Whether a person may edit this column of an existing row in a generated
 * grid cell or a record's detail field.
 *
 * It applies the create form's policy, so a column the table API rejects is
 * never offered for editing, and it also excludes `gridEditable: false`
 * columns, which the table API accepts but the grids only show. The create
 * form itself still asks for those columns.
 */
export function isGridEditableColumn(column: ColumnSchema): boolean {
  if (!isRecordFormEditableColumn(column)) return false;
  if (column.gridEditable === false) return false;
  return true;
}
