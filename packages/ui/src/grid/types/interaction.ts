// Interaction configuration is the grid's small "operating mode" language.
//
// The base grid supports two different ideas that are easy to blur together:
//
//   - a *cell grid*, like a spreadsheet, where the keyboard target is a
//     particular cell and Shift+arrows may create a rectangular cell range;
//   - a *row list*, like a master-detail list, where the keyboard target is a
//     row and Shift+arrows may extend a row operation selection.
//
// This module names those choices explicitly so the rest of the runtime does
// not have to infer intent from "whatever the user touched last". Once a
// runtime is constructed, `interaction.mode` owns keyboard routing. Checkbox
// clicks, row-selector cells, or side-panel selection chrome are allowed to
// change row selection, but they never change whether ArrowUp means "move a
// cell" or "move a row".
//
// The presets below are examples of valid compositions, not special cases in
// the runtime. Consumers can build their own config from the same primitives.

export type RowSelectionMode = "single" | "range" | "multi";

// Row selection can either be derived from the active row or stored
// independently. "Follows active row" is deliberately read-only at the
// storage layer: the effective selected rows are computed from the active row,
// and controller.rowSelection is ignored.
export type SelectedRowsSync =
  | { kind: "follows-active-row" }
  | { kind: "independent" };

export type SelectedRowsKeyboardConfig = {
  space: "toggle-active-row" | "ignore";
};

export type SelectedRowsConfig =
  | { kind: "none" }
  | {
      kind: "enabled";
      // Controls which shapes may be stored after normalization. Even in
      // "multi", helper functions project the value through displayed-row
      // order, so callers never depend on Set insertion order.
      mode: RowSelectionMode;
      sync: SelectedRowsSync;
      keyboard: SelectedRowsKeyboardConfig;
    };

export type SelectedCellsConfig =
  | { kind: "none" }
  | { kind: "range" };

export type CellGridActiveRowConfig =
  | { kind: "none" }
  // Active row is a derived view of the active cell's row. No row cursor is
  // created in cell-grid mode.
  | { kind: "from-active-cell" };

export type ActiveRowKeyboardConfig = {
  arrows: "move-active-row";
  shiftArrows: "extend-selected-rows" | "move-active-row";
};

export type RowListActiveRowConfig = {
  kind: "from-row-cursor";
  // Row-list keyboard policy belongs to the active row, because the row cursor
  // is the thing arrows move. Selection only participates when Shift+arrows
  // are explicitly configured to extend independent selected rows.
  keyboard: ActiveRowKeyboardConfig;
};

export type CellGridInteractionConfig = {
  mode: "cell-grid";
  activeCell: { kind: "enabled" };
  selectedCells: SelectedCellsConfig;
  activeRow: CellGridActiveRowConfig;
  selectedRows: SelectedRowsConfig;
};

export type RowListInteractionConfig = {
  mode: "row-list";
  activeCell: { kind: "none" };
  selectedCells: { kind: "none" };
  activeRow: RowListActiveRowConfig;
  selectedRows: SelectedRowsConfig;
};

export type GridInteractionConfig =
  | CellGridInteractionConfig
  | RowListInteractionConfig;

export const CELL_EDITING_GRID = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_EDITING_NO_SELECTION_GRID = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "none" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_GRID_WITH_ACTIVE_ROW = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "multi",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
} satisfies GridInteractionConfig;

export const CELL_PRIMARY_WITH_SIDE_PANEL_ROW = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "follows-active-row" },
    keyboard: { space: "ignore" },
  },
} satisfies GridInteractionConfig;

export const CELL_PRIMARY_WITH_SELECTED_SIDE_PANEL_ROW = {
  mode: "cell-grid",
  activeCell: { kind: "enabled" },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
} satisfies GridInteractionConfig;

export const ROW_PRIMARY_MASTER_DETAIL = {
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: { arrows: "move-active-row", shiftArrows: "move-active-row" },
  },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "follows-active-row" },
    keyboard: { space: "ignore" },
  },
} satisfies GridInteractionConfig;

export const ROW_MULTISELECT_LIST = {
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: {
      arrows: "move-active-row",
      shiftArrows: "extend-selected-rows",
    },
  },
  selectedRows: {
    kind: "enabled",
    mode: "multi",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
} satisfies GridInteractionConfig;
