import type { ColumnSchema } from "../core/types/schema";
import type { ColId } from "../core/types/identity";
import {
  columnSizingTemplateColumns,
  trackForColumnWidth,
  type ColumnSizingOverrides,
} from "./column-sizing";
import { preset } from "./preset";

export function trackForColumn(
  column: ColumnSchema,
  overrides?: Readonly<Record<ColId, number>>,
): string {
  const override = overrides?.[column.id];
  return override === undefined
    ? trackForColumnWidth(preset(column)?.layout.width)
    : `${override}px`;
}

export function templateColumns(
  columns: readonly ColumnSchema[],
  overrides?: ColumnSizingOverrides,
): string {
  return overrides
    ? columnSizingTemplateColumns(columns, overrides)
    : columns.map((column) => trackForColumn(column)).join(" ");
}
