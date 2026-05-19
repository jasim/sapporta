import type { ColId, Coord, RowId } from "./identity";
import type { DisplayedRows } from "./level-row";

export type SelectionState = {
  anchor: Coord;
  head: Coord;
};

export type CellSelectionStatus = "none" | "in-selection" | "focus" | "editing";

// Active-vs-ghost is NOT part of this enum. Active-ness is structural and
// lives on the coordinator (`cursor?.path === myPath`). It is level-scoped —
// every cell in a level shares the same value — so it lives on the grid
// container's `data-active` attribute, not on cell classes. Cells compose
// only `cellClasses(status)`; the active/ghost distinction reaches descendant
// cells via the CSS cascade. Transient-channel changes never invalidate
// active-ness selectors and vice versa.

export function makeSelection(coord: Coord): SelectionState {
  return { anchor: coord, head: coord };
}

export function selectionFocus(s: SelectionState): Coord {
  return s.head;
}

// True iff `coord` lies in the inclusive rectangle defined by anchor↔head.
// Row order is taken from `displayed.rowIndexById` (stable identity) — a
// reorder of the underlying array does not break this predicate.
// Column order is determined by the `colOrder` array (the level's schema ids
// in display order).
export function selectionContainsCoord(
  selection: SelectionState,
  coord: Coord,
  displayed: DisplayedRows,
  colOrder: readonly ColId[],
): boolean {
  const ai = displayed.rowIndexById.get(selection.anchor.rowId);
  const hi = displayed.rowIndexById.get(selection.head.rowId);
  const ci = displayed.rowIndexById.get(coord.rowId);
  if (ai == null || hi == null || ci == null) return false;
  const minR = Math.min(ai, hi);
  const maxR = Math.max(ai, hi);
  if (ci < minR || ci > maxR) return false;

  const ac = colOrder.indexOf(selection.anchor.colId);
  const hc = colOrder.indexOf(selection.head.colId);
  const cc = colOrder.indexOf(coord.colId);
  if (ac < 0 || hc < 0 || cc < 0) return false;
  const minC = Math.min(ac, hc);
  const maxC = Math.max(ac, hc);
  return cc >= minC && cc <= maxC;
}

export function selectionIsSingleCell(s: SelectionState): boolean {
  return s.anchor.rowId === s.head.rowId && s.anchor.colId === s.head.colId;
}

export function rowsInSelection(
  s: SelectionState,
  displayed: DisplayedRows,
): RowId[] {
  const ai = displayed.rowIndexById.get(s.anchor.rowId);
  const hi = displayed.rowIndexById.get(s.head.rowId);
  if (ai == null || hi == null) return [];
  const lo = Math.min(ai, hi);
  const hi2 = Math.max(ai, hi);
  return displayed.rows.slice(lo, hi2 + 1).map((r) => r.id);
}
