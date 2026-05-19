import type { RowId } from "../types/identity";
import type { ColumnSchema } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type { NavigationDirection, NavigationIntent } from "../types/action";
import { triggerAllowed } from "../types/schema";

// Pure key-handling — no React, no store, no callbacks.
//
// `keyEventToIntent` is a pure function of (KeyboardEvent, controller state,
// displayed rows, schema, capabilities). It decides "what does this key
// want to do" — including capability-aware skipping (don't focus a footer;
// don't start-edit a closing row) and `editTriggers` lookup (only open the
// editor on triggers the column allows).
//
// Cursor eligibility reads come from `state.liveFocus` (the per-path mirror
// of the global cursor). When the cursor is in another path, this controller's
// `liveFocus` is null and most key intents are no-ops. Movement targets are
// resolved later by the coordinator from the canonical cursor.
//
// While `editing != null`, this returns null — the editor's focused
// element decides what Escape/Enter/Tab mean and calls
// `onCommit`/`onCancel`.

// Page-jump distance for PageUp / PageDown. Rough — the visible page size is
// virtualization's concern, not the keyboard's.
const PAGE_SIZE = 10;

type CapabilitiesFn = (kind: LevelRowKind) => RowCapabilities;

// Map a synthetic or real KeyboardEvent into a NavigationDirection. Returns
// null when the key isn't a navigation key.
function directionForKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): NavigationDirection | null {
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case "ArrowUp":
      return ctrl ? "start" : "up";
    case "ArrowDown":
      return ctrl ? "end" : "down";
    case "ArrowLeft":
      return ctrl ? "rowStart" : "left";
    case "ArrowRight":
      return ctrl ? "rowEnd" : "right";
    case "Home":
      return ctrl ? "start" : "rowStart";
    case "End":
      return ctrl ? "end" : "rowEnd";
    case "PageUp":
      return "pageUp";
    case "PageDown":
      return "pageDown";
    case "Tab":
      return e.shiftKey ? "prev" : "next";
    default:
      return null;
  }
}

// Whether a key looks like printable input (i.e. opens an editor on
// `editTriggers: 'type'`). Modifier-bearing keys never open a typed edit;
// neither do single-character function-keyish strings like "Tab", "Escape".
function isPrintableKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}

function isHardEditCommit(e: Pick<KeyboardEvent, "key" | "shiftKey">): boolean {
  return e.key === "Enter" && !e.shiftKey;
}

export function keyEventToIntent(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  state: ControllerState,
  displayed: DisplayedRows,
  schema: ColumnSchema[],
  capabilities: CapabilitiesFn,
): NavigationIntent | null {
  // Edit mode swallows all keys — handled by the editor.
  if (state.editing) return null;

  // Escape clears the remembered range when one exists. The cursor is
  // not cleared here — the user's focus stays where it was.
  if (e.key === "Escape") {
    return state.selection ? { type: "clearSelection" } : null;
  }

  const direction = directionForKey(e);

  // No live focus on this path: nav keys focus the first focusable cell;
  // everything else is ignored. The coordinator resolves `focusFirst`
  // through the same focus-manager path as every other cursor move.
  if (!state.liveFocus) {
    if (!direction) return null;
    return { type: "focusFirst" };
  }

  const focus = state.liveFocus;

  if (direction) {
    const extend = !!e.shiftKey && direction !== "next" && direction !== "prev";
    switch (direction) {
      case "left":
      case "right":
      case "rowStart":
      case "rowEnd":
        return { type: "moveColumn", direction, extend };
      case "up":
      case "down":
        return { type: "moveRow", direction, colPolicy: "preserve", extend };
      case "start":
        return {
          type: "moveGridEdge",
          edge: "first",
          colPolicy: "preserve",
          extend,
        };
      case "end":
        return {
          type: "moveGridEdge",
          edge: "last",
          colPolicy: "preserve",
          extend,
        };
      case "pageUp":
        return {
          type: "moveRowDelta",
          delta: -PAGE_SIZE,
          colPolicy: "preserve",
          extend,
        };
      case "pageDown":
        return {
          type: "moveRowDelta",
          delta: PAGE_SIZE,
          colPolicy: "preserve",
          extend,
        };
      case "next":
      case "prev":
        return { type: "commitMove", target: direction };
    }
  }

  // Edit-start triggers — F2, Enter, or a printable type.
  const focusedRow = displayed.rowById.get(focus.rowId as RowId);
  if (!focusedRow) return null;
  const caps = capabilities(focusedRow.kind);
  if (!caps.editable) return null;
  const column = schema.find((c) => c.id === focus.colId);
  if (!column?.editCell) return null;

  if (e.key === "F2" && triggerAllowed(column, "f2")) {
    return { type: "startEdit", trigger: "f2" };
  }
  if (isHardEditCommit(e) && triggerAllowed(column, "enter")) {
    return { type: "startEdit", trigger: "enter" };
  }
  if (isPrintableKey(e) && triggerAllowed(column, "type")) {
    return { type: "startEdit", trigger: "type", initial: e.key };
  }

  return null;
}
