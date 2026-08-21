// The single home for "iterate DisplayedRows, gated by capability".
//
// The interaction layer never branches on `kind` directly — it consults
// `capabilitiesFor(kind)` (see ./capabilities.ts). The traversal idiom
// that flows from that rule — walk `displayed.rows` and stop at the first
// row whose capabilities say `focusable` — is the most common operation
// in the keyboard handler and the coordinator. It lives here exactly
// once. Adding a new traversal predicate (e.g. "next selectable" for
// range expansion, "next editable" for tab-skip-uneditable) belongs in
// this module.

import type { LevelRow, DisplayedRows, LevelRowKind } from "./level-row";
import type { RowCapabilities } from "./capabilities";

type CapabilitiesFn = (kind: LevelRowKind) => RowCapabilities;

// `fromIndex` is exclusive — the search starts at `fromIndex + step`.
// `step` is +1 (forward) or -1 (backward).
export function nextFocusableRow(
  displayed: DisplayedRows,
  fromIndex: number,
  step: 1 | -1,
  capabilities: CapabilitiesFn,
): LevelRow | null {
  const rows = displayed.rows;
  for (let i = fromIndex + step; i >= 0 && i < rows.length; i += step) {
    if (capabilities(rows[i].kind).focusable) return rows[i];
  }
  return null;
}

export const firstFocusableRow = (d: DisplayedRows, c: CapabilitiesFn) =>
  nextFocusableRow(d, -1, 1, c);

export const lastFocusableRow = (d: DisplayedRows, c: CapabilitiesFn) =>
  nextFocusableRow(d, d.rows.length, -1, c);
