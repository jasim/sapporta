import type { ColId, Coord, RowId } from "./identity";
import type { DisplayedRows, LevelRow } from "./level-row";
import type { ColumnSchema } from "./schema";

export type CellSelectionState = {
  readonly anchor: Coord;
  readonly head: Coord;
};

export type CellSelectionStatus = "none" | "in-selection" | "focus" | "editing";

// Active-vs-ghost is NOT part of this enum. Active-ness is structural and
// lives on the coordinator (`cursor?.path === myPath`). It is level-scoped —
// every cell in a level shares the same value — so it lives on the grid
// container's `data-active` attribute, not on cell classes. Cells expose only
// `data-cell-status`; the active/ghost distinction reaches descendant cells
// via the CSS cascade. Transient-channel changes never invalidate active-ness
// selectors and vice versa.

export function makeSelection(coord: Coord): CellSelectionState {
  return { anchor: coord, head: coord };
}

export function selectionFocus(s: CellSelectionState): Coord {
  return s.head;
}

// True iff `coord` lies in the inclusive rectangle defined by anchor↔head.
// Row order is taken from `displayed.rowIndexById` (stable identity) — a
// reorder of the underlying array does not break this predicate.
// Column order is determined by the `colOrder` array (the level's schema ids
// in display order).
export function selectionContainsCoord(
  selection: CellSelectionState,
  coord: Coord,
  displayed: DisplayedRows,
  colOrder: readonly ColId[],
): boolean {
  const rowBounds = selectionRowBounds(selection, displayed);
  const ci = displayed.rowIndexById.get(coord.rowId);
  if (!rowBounds || ci == null) return false;
  if (ci < rowBounds.first || ci > rowBounds.last) return false;

  const columnBounds = selectionColumnBounds(selection, colOrder);
  const cc = colOrder.indexOf(coord.colId);
  if (!columnBounds || cc < 0) return false;
  return cc >= columnBounds.first && cc <= columnBounds.last;
}

export function selectionIsSingleCell(s: CellSelectionState): boolean {
  return s.anchor.rowId === s.head.rowId && s.anchor.colId === s.head.colId;
}

/**
 * The displayed rows and columns covered by a cell selection.
 *
 * Both arrays follow the order currently shown in the Grid. This makes the
 * value suitable for calculations, auxiliary UI, and copy behavior without
 * requiring callers to translate row or column positions themselves.
 */
export type CellSelectionRectangle = {
  readonly rows: readonly LevelRow[];
  readonly columns: readonly ColumnSchema[];
};

/**
 * Resolves a stored cell selection against the rows and columns currently
 * displayed by a level.
 *
 * Use this in imperative Grid integrations. React components can use
 * `useCellSelectionRectangle` to receive the same value as live state. A
 * `null` result means that an endpoint is no longer displayed.
 */
export function resolveCellSelectionRectangle(
  selection: CellSelectionState,
  displayed: DisplayedRows,
  columns: readonly ColumnSchema[],
): CellSelectionRectangle | null {
  const rowBounds = selectionRowBounds(selection, displayed);
  const columnBounds = selectionColumnBounds(
    selection,
    columns.map((column) => column.id),
  );
  if (!rowBounds || !columnBounds) return null;

  return {
    rows: displayed.rows.slice(rowBounds.first, rowBounds.last + 1),
    columns: columns.slice(columnBounds.first, columnBounds.last + 1),
  };
}

// Project a cell selection to the rows it covers in one displayed path. This
// is not row selection: it is a cell-selection-to-row projection that commands
// may choose to use when computing row operation targets.
export function rowsInSelection(
  s: CellSelectionState,
  displayed: DisplayedRows,
): readonly RowId[] {
  const bounds = selectionRowBounds(s, displayed);
  if (!bounds) return [];
  return displayed.rows
    .slice(bounds.first, bounds.last + 1)
    .map((row) => row.id);
}

type IndexBounds = {
  readonly first: number;
  readonly last: number;
};

function selectionRowBounds(
  selection: CellSelectionState,
  displayed: DisplayedRows,
): IndexBounds | null {
  const anchor = displayed.rowIndexById.get(selection.anchor.rowId);
  const head = displayed.rowIndexById.get(selection.head.rowId);
  return anchor == null || head == null ? null : orderedBounds(anchor, head);
}

function selectionColumnBounds(
  selection: CellSelectionState,
  colOrder: readonly ColId[],
): IndexBounds | null {
  const anchor = colOrder.indexOf(selection.anchor.colId);
  const head = colOrder.indexOf(selection.head.colId);
  return anchor < 0 || head < 0 ? null : orderedBounds(anchor, head);
}

function orderedBounds(a: number, b: number): IndexBounds {
  return { first: Math.min(a, b), last: Math.max(a, b) };
}
