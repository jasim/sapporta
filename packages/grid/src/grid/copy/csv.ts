import { csvRow } from "@sapporta/shared/csv";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { ColumnSchema } from "../types/schema";
import type { GridCopyTarget } from "./target";

export type GridCopyCsvOptions = {
  includeHeaders: boolean;
};

export function serializeGridCopyTargetToCsv(
  runtime: GridRuntime,
  target: GridCopyTarget,
  options: GridCopyCsvOptions,
): string | null {
  const displayed = safeRead(() => runtime.displayedRowsFor(target.path));
  const columns = safeRead(() => runtime.schemaAt(target.path).columns);
  if (!displayed || !columns) return null;

  const anchorRowIndex = displayed.rowIndexById.get(
    target.selection.anchor.rowId,
  );
  const headRowIndex = displayed.rowIndexById.get(target.selection.head.rowId);
  if (anchorRowIndex == null || headRowIndex == null) return null;

  const anchorColumnIndex = columnIndex(columns, target.selection.anchor.colId);
  const headColumnIndex = columnIndex(columns, target.selection.head.colId);
  if (anchorColumnIndex < 0 || headColumnIndex < 0) return null;

  const minRowIndex = Math.min(anchorRowIndex, headRowIndex);
  const maxRowIndex = Math.max(anchorRowIndex, headRowIndex);
  const minColumnIndex = Math.min(anchorColumnIndex, headColumnIndex);
  const maxColumnIndex = Math.max(anchorColumnIndex, headColumnIndex);
  const selectedColumns = columns.slice(minColumnIndex, maxColumnIndex + 1);
  const selectedRows = displayed.rows.slice(minRowIndex, maxRowIndex + 1);

  const lines: string[] = [];
  if (options.includeHeaders) {
    lines.push(csvRow(selectedColumns.map((column) => column.name)));
  }
  for (const row of selectedRows) {
    lines.push(csvRow(selectedColumns.map((column) => row.columns[column.id])));
  }
  return lines.join("\n");
}

function columnIndex(columns: readonly ColumnSchema[], colId: string): number {
  return columns.findIndex((column) => column.id === colId);
}

function safeRead<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
