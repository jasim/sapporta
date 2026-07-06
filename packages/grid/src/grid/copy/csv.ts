import { csvRow } from "@sapporta/shared/csv";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { GridPath } from "../types/identity";
import type { LevelRow } from "../types/level-row";
import type { ColumnSchema, GridCopyColumn } from "../types/schema";
import type { GridCopyTarget } from "./target";

export type GridCopyCsvOptions = {
  includeHeaders: boolean;
};

type GridCopySelection = {
  path: GridPath;
  rows: readonly LevelRow[];
  columns: readonly ColumnSchema[];
};

type GridClipboardTable = {
  headers: readonly string[];
  rows: readonly (readonly unknown[])[];
};

export async function serializeGridCopyTargetToCsv(
  runtime: GridRuntime,
  target: GridCopyTarget,
  options: GridCopyCsvOptions,
): Promise<string | null> {
  const selection = readGridCopySelection(runtime, target);
  if (!selection) return null;

  const table = await buildGridClipboardTable(selection);
  return serializeGridClipboardTableToCsv(table, options);
}

function readGridCopySelection(
  runtime: GridRuntime,
  target: GridCopyTarget,
): GridCopySelection | null {
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

  return {
    path: target.path,
    rows: selectedRows,
    columns: selectedColumns,
  };
}

async function buildGridClipboardTable(
  selection: GridCopySelection,
): Promise<GridClipboardTable> {
  const copyColumns: GridCopyColumn[] = [];

  for (const column of selection.columns) {
    const copy = column.copy ?? defaultGridCopyColumns;
    const produced = await copy({
      path: selection.path,
      column,
      rows: selection.rows,
    });
    copyColumns.push(...produced);
  }

  return {
    headers: uniqueCopyHeaders(
      copyColumns.map((copyColumn) => copyColumn.header),
    ),
    rows: selection.rows.map((row, rowIndex) =>
      copyColumns.map((copyColumn) => copyColumn.valueAt(row, rowIndex)),
    ),
  };
}

function serializeGridClipboardTableToCsv(
  table: GridClipboardTable,
  options: GridCopyCsvOptions,
): string {
  const lines: string[] = [];
  if (options.includeHeaders) {
    lines.push(csvRow(table.headers));
  }
  for (const row of table.rows) {
    lines.push(csvRow(row));
  }
  return lines.join("\n");
}

function defaultGridCopyColumns({
  column,
}: {
  column: ColumnSchema;
}): readonly GridCopyColumn[] {
  return [
    {
      header: column.id,
      valueAt: (row) => row.columns[column.id],
    },
  ];
}

function uniqueCopyHeaders(headers: readonly string[]): string[] {
  const countsByHeader = new Map<string, number>();
  return headers.map((header) => {
    const count = countsByHeader.get(header) ?? 0;
    const nextCount = count + 1;
    countsByHeader.set(header, nextCount);
    return count === 0 ? header : `${header}_${nextCount}`;
  });
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
