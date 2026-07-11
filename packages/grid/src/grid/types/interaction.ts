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
//
// Vocabulary:
//
//   - cursor: where the next navigation action starts.
//   - cell selection: a selected rectangle of cells inside one GridPath.
//   - row selection: selected rows inside one GridPath, either stored
//     independently or derived from active row.
//   - active row: the row carrying row-level context.
//   - row operation target: rows a command such as delete/export/bulk edit will
//     affect. This is a command-level projection, not a controller field.
//   - scope: the set of GridPaths a command includes. Interaction config
//     describes behavior inside a path; multi-path aggregation is a caller
//     decision.

export type RowSelectionMode = "single" | "range" | "multi";

// A row-selection control reduces platform input to one of three stable
// meanings. Replace starts a new operation selection. Extend keeps the current
// path's anchor. Toggle changes one row's membership while preserving selected
// rows in other materialized child tables.
export type RowSelectionGesture = "replace" | "extend" | "toggle";

// Row selection can either be derived from the active row or stored
// independently. "Follows active row" is deliberately read-only at the
// storage layer: the effective selected rows are computed from the active row,
// and controller.rowSelection is ignored.
export type SelectedRowsSync =
  | { readonly kind: "follows-active-row" }
  | { readonly kind: "independent" };

export type SelectedRowsKeyboardConfig = {
  readonly space: "toggle-active-row" | "ignore";
};

export type SelectedRowsConfig =
  | { readonly kind: "none" }
  | {
      readonly kind: "enabled";
      // Controls which shapes may be stored after normalization. Even in
      // "multi", helper functions project the value through displayed-row
      // order, so callers never depend on Set insertion order.
      readonly mode: RowSelectionMode;
      readonly sync: SelectedRowsSync;
      readonly keyboard: SelectedRowsKeyboardConfig;
    };

export type SelectedCellsConfig =
  | { readonly kind: "none" }
  | { readonly kind: "range" };

export type CellArrowKeyBehavior = "grid" | "field-list";

export type ActiveCellKeyboardConfig = {
  readonly arrows: {
    readonly tabular: CellArrowKeyBehavior;
    readonly cards: CellArrowKeyBehavior;
  };
};

export type CellGridActiveRowConfig =
  | { readonly kind: "none" }
  // Active row is a derived view of the active cell's row. No row cursor is
  // created in cell-grid mode.
  | { readonly kind: "from-active-cell" };

export type ActiveRowKeyboardConfig = {
  readonly arrows: "move-active-row";
  readonly shiftArrows: "extend-selected-rows" | "move-active-row";
  readonly expansion: "left-right-enter" | "none";
};

export type RowListActiveRowConfig = {
  readonly kind: "from-row-cursor";
  // Row-list keyboard policy belongs to the active row, because the row cursor
  // is the thing arrows move. Selection only participates when Shift+arrows
  // are explicitly configured to extend independent selected rows.
  readonly keyboard: ActiveRowKeyboardConfig;
};

export type CellGridInteractionConfig = {
  readonly mode: "cell-grid";
  readonly activeCell: {
    readonly kind: "enabled";
    readonly keyboard: ActiveCellKeyboardConfig;
  };
  readonly selectedCells: SelectedCellsConfig;
  readonly activeRow: CellGridActiveRowConfig;
  readonly selectedRows: SelectedRowsConfig;
};

export type RowListInteractionConfig = {
  readonly mode: "row-list";
  readonly activeCell: { readonly kind: "none" };
  readonly selectedCells: { readonly kind: "none" };
  readonly activeRow: RowListActiveRowConfig;
  readonly selectedRows: SelectedRowsConfig;
};

export type GridInteractionConfig =
  | CellGridInteractionConfig
  | RowListInteractionConfig;

export const CELL_EDITING_GRID = {
  mode: "cell-grid",
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
  selectedCells: { kind: "range" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_EDITING_NO_SELECTION_GRID = {
  mode: "cell-grid",
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
  selectedCells: { kind: "none" },
  activeRow: { kind: "none" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_GRID_WITH_ACTIVE_ROW = {
  mode: "cell-grid",
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
  selectedCells: { kind: "range" },
  activeRow: { kind: "from-active-cell" },
  selectedRows: { kind: "none" },
} satisfies GridInteractionConfig;

export const CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION = {
  mode: "cell-grid",
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
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
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
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
  activeCell: {
    kind: "enabled",
    keyboard: { arrows: { tabular: "grid", cards: "field-list" } },
  },
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
    keyboard: {
      arrows: "move-active-row",
      shiftArrows: "move-active-row",
      expansion: "left-right-enter",
    },
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
      expansion: "none",
    },
  },
  selectedRows: {
    kind: "enabled",
    mode: "multi",
    sync: { kind: "independent" },
    keyboard: { space: "toggle-active-row" },
  },
} satisfies GridInteractionConfig;
