import type { CellCursor, ColId, GridPath, RowId } from "../types/identity";
import type { RowCursor } from "../types/row-selection";

// A cursor continuation is an executable landing decision. It deliberately
// contains no pending/loading state: callers compute it from a pre-mutation
// visible-row snapshot, then apply it before the mutation begins.
export type CursorContinuation =
  | { readonly kind: "cell"; readonly target: CellCursor }
  | { readonly kind: "row"; readonly target: RowCursor }
  | { readonly kind: "grid"; readonly path: GridPath };

export type RowRemovalRef = {
  readonly path: GridPath;
  readonly rowId: RowId;
};

// Pure planner input. The runtime adapter owns the live-tree walk and marks
// rows that disappear either directly or with a removed ancestor. Keeping that
// structural work outside the planner makes every landing policy testable with
// ordinary data.
export type CursorContinuationRow = {
  readonly path: GridPath;
  readonly rowId: RowId;
  readonly survivesRemoval: boolean;
  readonly cellFocusable: boolean;
  readonly rowSelectable: boolean;
  readonly colIds: readonly ColId[];
};

export type CursorContinuationInput =
  | {
      readonly mode: "cell-grid";
      readonly rows: readonly CursorContinuationRow[];
      readonly cellCursor: CellCursor | null;
      readonly rowSelectionLead: RowCursor | null;
      readonly fallbackPath: GridPath;
    }
  | {
      readonly mode: "row-list";
      readonly rows: readonly CursorContinuationRow[];
      readonly rowCursor: RowCursor | null;
      readonly rowSelectionLead: RowCursor | null;
      readonly fallbackPath: GridPath;
    };

export function planCursorContinuation(
  input: CursorContinuationInput,
): CursorContinuation {
  const origin =
    input.mode === "cell-grid"
      ? (input.cellCursor ?? input.rowSelectionLead)
      : (input.rowCursor ?? input.rowSelectionLead);
  const originIndex = origin
    ? input.rows.findIndex(
        (row) => row.path === origin.path && row.rowId === origin.rowId,
      )
    : -1;
  const canLand =
    input.mode === "cell-grid"
      ? (row: CursorContinuationRow) =>
          row.survivesRemoval && row.cellFocusable && row.colIds.length > 0
      : (row: CursorContinuationRow) =>
          row.survivesRemoval && row.rowSelectable;

  const originRow = originIndex >= 0 ? input.rows[originIndex] : undefined;
  const landingRow =
    originRow && canLand(originRow)
      ? originRow
      : (rowAfter(input.rows, originIndex, canLand) ??
        rowBefore(input.rows, originIndex, canLand) ??
        (originIndex < 0 ? input.rows.find(canLand) : undefined));

  if (!landingRow) return { kind: "grid", path: input.fallbackPath };

  if (input.mode === "row-list") {
    return {
      kind: "row",
      target: { path: landingRow.path, rowId: landingRow.rowId },
    };
  }

  const sourceColId = input.cellCursor?.colId;
  const colId =
    sourceColId && landingRow.colIds.includes(sourceColId)
      ? sourceColId
      : landingRow.colIds[0];
  if (!colId) return { kind: "grid", path: input.fallbackPath };
  return {
    kind: "cell",
    target: {
      path: landingRow.path,
      rowId: landingRow.rowId,
      colId,
    },
  };
}

function rowAfter(
  rows: readonly CursorContinuationRow[],
  originIndex: number,
  canLand: (row: CursorContinuationRow) => boolean,
): CursorContinuationRow | undefined {
  for (let index = originIndex + 1; index < rows.length; index += 1) {
    if (canLand(rows[index])) return rows[index];
  }
  return undefined;
}

function rowBefore(
  rows: readonly CursorContinuationRow[],
  originIndex: number,
  canLand: (row: CursorContinuationRow) => boolean,
): CursorContinuationRow | undefined {
  const start = originIndex < 0 ? rows.length - 1 : originIndex - 1;
  for (let index = start; index >= 0; index -= 1) {
    if (canLand(rows[index])) return rows[index];
  }
  return undefined;
}
