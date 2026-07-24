import type { RowId } from "../types/identity";
import type { ColumnSchema } from "../types/schema";
import type { ControllerState } from "../types/controller-state";
import type { DisplayedRows, LevelRow } from "../types/level-row";
import type {
  CellNavigationIntent,
  NavigationDirection,
  RowNavigationIntent,
} from "../types/action";
import type {
  CellGridInteractionConfig,
  GridPointerInput,
  GridInteractionConfig,
  RowSelectionGesture,
  RowListInteractionConfig,
} from "../types/interaction";
import { activationStartsOn, editStartsOn } from "../types/schema";

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

export type CellKeyboardPresentation = "tabular" | "cards";
export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

export function rowSelectionGestureFromModifiers(modifiers: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): RowSelectionGesture {
  // The platform toggle modifier takes precedence over Shift. A combined
  // Ctrl/Cmd+Shift gesture changes one row's membership; it does not rebuild a
  // range from the current anchor.
  if (modifiers.ctrlKey || modifiers.metaKey) return "toggle";
  return modifiers.shiftKey ? "extend" : "replace";
}

function directionForKey(e: KeyEventLike): NavigationDirection | null {
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case "ArrowUp":
      return ctrl ? "start" : "up";
    case "ArrowDown":
      return ctrl ? "end" : "down";
    case "ArrowLeft":
      // Let keyboard users go back in the browser with Cmd+Left.
      if (e.metaKey) return null;
      return e.ctrlKey ? "rowStart" : "left";
    case "ArrowRight":
      // Let keyboard users go forward in the browser with Cmd+Right.
      if (e.metaKey) return null;
      return e.ctrlKey ? "rowEnd" : "right";
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

function isPlainEnter(e: KeyEventLike): boolean {
  return (
    e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
  );
}

function isPlainSpace(e: KeyEventLike): boolean {
  return e.key === " " && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function isShiftSpace(e: KeyEventLike): boolean {
  return e.key === " " && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function canToggleRows(
  config: CellGridInteractionConfig | RowListInteractionConfig,
): boolean {
  // Shift+Space mutates stored row selection only when there is such a stored
  // value. If selection follows active row, it would have nowhere meaningful
  // to write and the effective selection remains derived from movement.
  return (
    config.selectedRows.kind === "enabled" &&
    config.selectedRows.sync.kind === "independent"
  );
}

export function keyEventToCellIntent(
  e: KeyEventLike,
  config: CellGridInteractionConfig,
  state: ControllerState,
  displayed: DisplayedRows,
  schema: readonly ColumnSchema[],
  isCellEditable: (row: LevelRow, column: ColumnSchema) => boolean,
  presentation: CellKeyboardPresentation = "tabular",
): CellNavigationIntent | null {
  if (state.editing) return null;

  if (e.key === "Escape") {
    if (state.cellSelection) return { type: "clearCellSelection" };
    return state.rowSelection ? { type: "clearRowSelection" } : null;
  }

  const direction = directionForKey(e);
  if (!state.liveCellFocus) {
    if (!direction) return null;
    return { type: "focusFirstCell" };
  }

  const focus = state.liveCellFocus;
  const focusedRow = displayed.rowById.get(focus.rowId as RowId);
  const column = schema.find((c) => c.id === focus.colId);

  if (isShiftSpace(e)) {
    return canToggleRows(config) ? { type: "toggleActiveRowSelection" } : null;
  }

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
        target: e.key === "ArrowUp" || e.key === "ArrowLeft" ? "prev" : "next",
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

  if (!focusedRow) return null;

  // Space is the expansion command for a column that exposes row expansion.
  // Resolve it before printable-key editing because the browser reports Space
  // as a one-character key. Shift+Space has already been reserved for row
  // selection above, so these two commands cannot start the same interaction.
  if (column && isPlainSpace(e) && activationStartsOn(column, "space")) {
    return {
      type: "activateCell",
      coord: focus,
      trigger: { kind: "keyboard", gesture: "space" },
    };
  }

  if (isPlainEnter(e)) {
    // Enter means "perform this cell's primary action." Keep this order: a
    // writable data cell opens its editor; the same column on a readonly source
    // or structural row runs its cell activation; row activation is the final
    // fallback. Expansion columns intentionally declare both edit and Enter
    // activation so this decision can follow the focused cell's live state.
    if (
      column &&
      isCellEditable(focusedRow, column) &&
      editStartsOn(column, "enter")
    ) {
      return { type: "startEdit", coord: focus, trigger: "enter" };
    }
    if (column && activationStartsOn(column, "enter")) {
      return {
        type: "activateCell",
        coord: focus,
        trigger: { kind: "keyboard", gesture: "enter" },
      };
    }
    return rowActivationStartsOn(config, "enter")
      ? {
          type: "activateRow",
          rowId: focus.rowId,
          coord: focus,
          trigger: { kind: "keyboard", gesture: "enter" },
        }
      : null;
  }

  if (!column || !isCellEditable(focusedRow, column)) return null;
  if (isPrintableKey(e) && editStartsOn(column, "type")) {
    return {
      type: "startEdit",
      coord: focus,
      trigger: "type",
      initial: e.key,
    };
  }

  return null;
}

export function pointerEventToCellIntent(args: {
  column: ColumnSchema;
  rowId: RowId;
  editable: boolean;
  gesture: "click" | "doubleClick";
}): CellNavigationIntent | null {
  const coord = { rowId: args.rowId, colId: args.column.id };
  if (activationStartsOn(args.column, args.gesture)) {
    return {
      type: "activateCell",
      coord,
      trigger: { kind: "pointer", gesture: args.gesture },
    };
  }
  if (
    args.gesture === "doubleClick" &&
    args.editable &&
    args.column.edit &&
    editStartsOn(args.column, "doubleClick")
  ) {
    return { type: "startEdit", coord, trigger: "doubleClick" };
  }
  return null;
}

export function pointerEventToRowIntent(args: {
  config: GridInteractionConfig;
  rowId: RowId;
  pointer: GridPointerInput;
}): RowNavigationIntent | null {
  const { pointer } = args;
  if (
    pointer.button !== 0 ||
    pointer.altKey ||
    pointer.ctrlKey ||
    pointer.metaKey ||
    pointer.shiftKey ||
    !rowActivationStartsOn(args.config, pointer.gesture)
  ) {
    return null;
  }
  return {
    type: "activateRow",
    rowId: args.rowId,
    trigger: { kind: "pointer", gesture: pointer.gesture },
  };
}

export function rowActivationStartsOn(
  config: GridInteractionConfig,
  gesture: "enter" | "click" | "doubleClick",
): boolean {
  return (
    config.activeRow.kind !== "none" &&
    (config.activeRow.activation?.startsOn.includes(gesture) ?? false)
  );
}

export function keyEventToRowIntent(
  e: KeyEventLike,
  config: RowListInteractionConfig,
  state: ControllerState,
): RowNavigationIntent | null {
  if (e.key === "Escape") {
    return state.rowSelection ? { type: "clearRowSelection" } : null;
  }

  if (isShiftSpace(e)) {
    return canToggleRows(config) ? { type: "toggleActiveRowSelection" } : null;
  }

  const direction = directionForKey(e);
  if (!state.liveRowFocus) {
    if (!direction) return null;
    return { type: "focusFirstRow" };
  }
  // A row list has no focused cell whose primary action needs resolving:
  // Space owns expansion, while Enter remains available for the app's row
  // activation command.
  if (isPlainSpace(e)) {
    return config.activeRow.keyboard.expansion === "enabled"
      ? { type: "toggleActiveRowExpansion" }
      : null;
  }
  if (isPlainEnter(e)) {
    if (rowActivationStartsOn(config, "enter")) {
      return {
        type: "activateRow",
        rowId: state.liveRowFocus,
        trigger: { kind: "keyboard", gesture: "enter" },
      };
    }
    return null;
  }
  if (!direction) return null;

  const extend =
    !!e.shiftKey &&
    config.activeRow.keyboard.shiftArrows === "extend-selected-rows" &&
    config.selectedRows.kind === "enabled" &&
    config.selectedRows.sync.kind === "independent";

  switch (direction) {
    case "right":
      return config.activeRow.keyboard.expansion === "enabled"
        ? { type: "expandActiveRow" }
        : null;
    case "left":
      return config.activeRow.keyboard.expansion === "enabled"
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
