import type { ColumnSchema } from "../core/types/schema";
import type { ColId } from "../core/types/identity";
import {
  columnSizingTemplateColumns,
  DEFAULT_COLUMN_RESIZE_MIN_PX,
  trackForColumnWidth,
  type ColumnSizingOverrides,
} from "./column-sizing";
import { preset } from "./preset";
import type { ColumnWidthMinimums } from "./types";

export function trackForColumn(
  column: ColumnSchema,
  overrides?: Readonly<Record<ColId, number>>,
  minWidths?: ColumnWidthMinimums,
): string {
  const override = overrides?.[column.id];
  return override === undefined
    ? trackForColumnWidth(preset(column)?.layout.width, minWidths)
    : `${override}px`;
}

export function templateColumns(
  columns: readonly ColumnSchema[],
  overrides?: ColumnSizingOverrides,
  minWidths?: ColumnWidthMinimums,
): string {
  return overrides
    ? columnSizingTemplateColumns(
        columns,
        overrides,
        DEFAULT_COLUMN_RESIZE_MIN_PX,
        minWidths,
      )
    : columns
        .map((column) => trackForColumn(column, undefined, minWidths))
        .join(" ");
}
