/**
 * Field projection for the record detail sheet.
 *
 * The sheet shows one row of a table level as label/value lines and lets the
 * user edit fields through the same form controls as the new-record form. This
 * module derives those fields from the level's built grid columns, so the
 * sheet follows the view: column order, view labels, and included columns all
 * match what the grid shows, while client columns (view-only interactive
 * content with no stored value) stay out of the record surface.
 *
 * Editability follows the record-form policy plus the grid column's own edit
 * state. Date and timestamp columns are the deliberate exception: grid cells
 * cannot host a calendar editor, so their columns are built readonly, but the
 * sheet's form controls can edit them — that gap is a reason this surface
 * exists.
 */

import type { ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercentage,
  formatText,
  formatTimestamp,
} from "@sapporta/grid/column-preset";
import { isLookupValue } from "@sapporta/grid/lookup";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  formatInstantForDateTimeLocalInput,
  formatPlainDateForDateInput,
} from "@sapporta/shared/temporal";
import { appTimeZone } from "../../platform/app-time-zone";
import type { LookupStore } from "../../lookup";
import { isRecordFormEditableColumn } from "../form/field-policy";
import {
  buildRecordFormFields,
  type RecordFormFieldModel,
} from "../form/record-form-fields";
import type {
  TGridColumnMapper,
  TGridTableColumnMeta,
} from "../tgrid/tgrid-column-mapper";

export type RecordDetailField = {
  column: GridColumnSchema;
  meta: TGridTableColumnMeta;
  /** Present when the sheet lets the user edit this field. */
  form: RecordFormFieldModel | null;
};

export function buildRecordDetailFields(args: {
  table: TableSchema;
  columns: readonly GridColumnSchema[];
  columnMapper: TGridColumnMapper;
  lookups: LookupStore;
}): RecordDetailField[] {
  const formModels = new Map(
    buildRecordFormFields({ table: args.table, lookups: args.lookups }).map(
      (field) => [field.column.name, field],
    ),
  );

  const fields: RecordDetailField[] = [];
  for (const column of args.columns) {
    const meta = args.columnMapper.metaOf(column);
    if (!meta) continue;
    const form = isDetailEditableColumn(args.table, column, meta)
      ? (formModels.get(meta.schema.name) ?? null)
      : null;
    fields.push({ column, meta, form });
  }
  return fields;
}

function isDetailEditableColumn(
  table: TableSchema,
  column: GridColumnSchema,
  meta: TGridTableColumnMeta,
): boolean {
  if (table.immutable) return false;
  if (meta.displayType === "pk") return false;
  if (!isRecordFormEditableColumn(meta.schema)) return false;
  if (meta.displayType === "date" || meta.displayType === "timestamp") {
    return true;
  }
  return column.edit !== undefined;
}

/**
 * The initial control draft for one field, from the cell value the grid holds.
 * Form controls speak drafts — raw text for numeric kinds, wall-clock text for
 * temporal kinds — so the stored value must be converted before editing starts.
 */
export function recordFieldDraft(
  field: RecordFormFieldModel,
  value: unknown,
): unknown {
  switch (field.kind) {
    case "checkbox":
      return value === true;
    case "date":
      return formatPlainDateForDateInput(value);
    case "timestamp":
      return formatInstantForDateTimeLocalInput(value, appTimeZone());
    case "select":
      return typeof value === "string" ? value : null;
    case "foreignKey":
      return isLookupValue(value) ? value : null;
    case "text":
    case "number":
    case "currency":
    case "percentage":
      return value == null ? "" : String(value);
  }
}

/**
 * Reading text for one field value, matching the grid cell's formatting.
 * Foreign keys resolve to lookup labels in the component layer; this returns
 * the raw identifier as their fallback.
 */
export function formatRecordFieldValue(
  meta: TGridTableColumnMeta,
  value: unknown,
): string {
  switch (meta.displayType) {
    case "number":
      return formatNumber(value);
    case "currency":
      return formatCurrency(value);
    case "percentage":
      return formatPercentage(value);
    case "date":
      return formatDate(value, appTimeZone());
    case "timestamp":
      return formatTimestamp(value, appTimeZone());
    case "checkbox":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "pk":
    case "fk":
    case "select":
    case "text":
      return formatText(value);
  }
}

const MONO_DISPLAY_TYPES: ReadonlySet<TGridTableColumnMeta["displayType"]> =
  new Set(["pk", "fk", "number", "currency", "percentage", "date", "timestamp"]);

export function isMonoRecordField(meta: TGridTableColumnMeta): boolean {
  return MONO_DISPLAY_TYPES.has(meta.displayType);
}

/**
 * The sheet heading: the same row-label column that titles the record's card.
 * Null when the view has no title column or the value is empty, in which case
 * the sheet falls back to the table label.
 */
export function recordDetailTitle(
  fields: readonly RecordDetailField[],
  rowValues: Readonly<Record<string, unknown>>,
): string | null {
  const titleField = fields.find((field) => field.meta.cardRole === "title");
  if (!titleField) return null;
  const text = formatRecordFieldValue(
    titleField.meta,
    rowValues[titleField.column.id],
  );
  return text.trim() === "" ? null : text;
}
