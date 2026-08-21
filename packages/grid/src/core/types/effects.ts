// The effects queue — how pure reducers touch the DOM.
//
// Reducers must be pure, but some outcomes need DOM work: focusing a
// cell, scrolling into view, marking the editor mount. Instead of
// calling imperative functions from inside the reducer, the reducer
// appends GridEffect objects to a sibling Zustand store
// (`controller.effects`). EffectRunner subscribes to that store and
// drains the queue in a single useEffect after layout.
//
// Host I/O (mutationCommitted, cellSelectionChanged, etc.) does NOT travel
// through this channel — it goes through the runtime emitter. The
// effects channel is DOM-only.
//
// This keeps the reducer testable (pure function of state + action →
// state + effects) and prevents imperative calls from leaking into the
// render path. The queue's array identity is preserved across no-op
// transitions — the subscription only fires when new effects are queued.

import type { Coord, RowId } from "./identity";

// Cursor placement when an editor opens.
export type CursorPlacement = "selectAll" | "atEnd";

export type GridEffect =
  | { readonly type: "focusContainer" }
  | { readonly type: "focusCellEditor"; readonly cursor: CursorPlacement }
  | { readonly type: "scrollFocusIntoView"; readonly coord: Coord }
  | { readonly type: "scrollRowIntoView"; readonly rowId: RowId };
