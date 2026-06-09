import type { RowId } from "../types/identity";
import type { ColumnSchema } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type {
  CellNavigationIntent,
  NavigationDirection,
  RowNavigationIntent,
} from "../types/action";
import type {
  CellGridInteractionConfig,
  RowListInteractionConfig,
} from "../types/interaction";
import { triggerAllowed } from "../types/schema";

// Keyboard parsing is intentionally split by interaction domain.
//
// In cell-grid mode, arrows, Tab, Enter, editing triggers, and cell-range
// extension are all interpreted relative to `liveCellFocus`.
//
// In row-list mode, editing keys are ignored and arrows move `liveRowFocus`.
// Shift only means "extend row selection" when the row-list config opts into
// that behavior and selected rows are independent.
//
// This avoids a subtle UI bug class: clicking a row selector checkbox must not
// make ArrowUp suddenly behave like row navigation in a spreadsheet-style grid.
const PAGE_SIZE = 10;

type CapabilitiesFn = (kind: LevelRowKind) => RowCapabilities;
export type CellKeyboardPresentation = "tabular" | "cards";
export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

function directionForKey(e: KeyEventLike): NavigationDirection | null {
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

function isPrintableKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}

function isHardEditCommit(e: Pick<KeyboardEvent, "key" | "shiftKey">): boolean {
  return e.key === "Enter" && !e.shiftKey;
}

function canToggleRows(
  config: CellGridInteractionConfig | RowListInteractionConfig,
): boolean {
  // Space mutates stored row selection only when there is such a stored value.
  // If selection follows active row, Space would have nowhere meaningful to
  // write and the effective selection remains derived from movement.
  return (
    config.selectedRows.kind === "enabled" &&
    config.selectedRows.sync.kind === "independent" &&
    config.selectedRows.keyboard.space === "toggle-active-row"
  );
}

export function keyEventToCellIntent(
  e: KeyEventLike,
  config: CellGridInteractionConfig,
  state: ControllerState,
  displayed: DisplayedRows,
  schema: ColumnSchema[],
  capabilities: CapabilitiesFn,
  presentation: CellKeyboardPresentation = "tabular",
): CellNavigationIntent | null {
  if (state.editing) return null;

  if (e.key === "Escape") {
    return state.cellSelection ? { type: "clearCellSelection" } : null;
  }

  if (e.key === " " && canToggleRows(config)) {
    return { type: "toggleActiveRowSelection" };
  }

  const direction = directionForKey(e);
  if (!state.liveCellFocus) {
    if (!direction) return null;
    return { type: "focusFirstCell" };
  }

  const focus = state.liveCellFocus;

  if (direction) {
    if (
      config.activeCell.keyboard.arrows[presentation] === "field-list" &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight")
    ) {
      return {
        type: "commitMove",
        target:
          e.key === "ArrowUp" || e.key === "ArrowLeft" ? "prev" : "next",
      };
    }

    // Shift+movement only creates a cell range when this cell-grid actually has
    // selected cells. In "no cell selection" presets, Shift+arrows still move
    // the cell cursor but do not write a remembered range.
    const extend =
      !!e.shiftKey &&
      direction !== "next" &&
      direction !== "prev" &&
      config.selectedCells.kind === "range";
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

export function keyEventToRowIntent(
  e: KeyEventLike,
  config: RowListInteractionConfig,
  state: ControllerState,
  _displayed: DisplayedRows,
): RowNavigationIntent | null {
  if (e.key === "Escape") {
    return state.rowSelection ? { type: "clearRowSelection" } : null;
  }

  if (e.key === " " && canToggleRows(config)) {
    return { type: "toggleActiveRowSelection" };
  }

  const direction = directionForKey(e);
  if (!state.liveRowFocus) {
    if (!direction) return null;
    return { type: "focusFirstRow" };
  }
  if (e.key === "Enter" && !e.shiftKey) {
    return config.activeRow.keyboard.expansion === "left-right-enter"
      ? { type: "toggleActiveRowExpansion" }
      : null;
  }
  if (!direction) return null;

  const extend =
    !!e.shiftKey &&
    config.activeRow.keyboard.shiftArrows === "extend-selected-rows" &&
    config.selectedRows.kind === "enabled" &&
    config.selectedRows.sync.kind === "independent";

  switch (direction) {
    case "right":
      return config.activeRow.keyboard.expansion === "left-right-enter"
        ? { type: "expandActiveRow" }
        : null;
    case "left":
      return config.activeRow.keyboard.expansion === "left-right-enter"
        ? { type: "collapseActiveRow" }
        : null;
    case "up":
    case "down":
      return { type: "moveActiveRow", direction, extend };
    case "start":
      return { type: "moveActiveRowEdge", edge: "first", extend };
    case "end":
      return { type: "moveActiveRowEdge", edge: "last", extend };
    case "pageUp":
      return { type: "moveActiveRowDelta", delta: -PAGE_SIZE, extend };
    case "pageDown":
      return { type: "moveActiveRowDelta", delta: PAGE_SIZE, extend };
    default:
      return null;
  }
}
