import type { DisplayedRows, LevelRow } from "../../types/level-row";
import type { RowId } from "../../types/identity";

// Build the lookup tables that the keyboard handler, range bounds, and
// scroll routing need in O(1).
export function buildDisplayed(rows: LevelRow[]): DisplayedRows {
  const rowById = new Map<RowId, LevelRow>();
  const rowIndexById = new Map<RowId, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    rowById.set(r.id, r);
    rowIndexById.set(r.id, i);
  }
  return { rows, rowById, rowIndexById };
}

export const EMPTY_DISPLAYED: DisplayedRows = {
  rows: [],
  rowById: new Map(),
  rowIndexById: new Map(),
};
