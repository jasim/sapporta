// Interaction configuration answers navigation and selection questions. It
// does not describe a view composition.
//
// Read a configuration in this order:
//
//   1. `mode` chooses the keyboard cursor. A cell grid moves between cells. A
//      row list moves between whole rows. This is the primary choice.
//   2. `activeCell` and `activeRow` expose context derived from that cursor.
//      An active row is simply the row carrying application context; it does
//      not imply that a detail view exists.
//   3. `selectedCells` and `selectedRows` choose operation targets. Selection
//      answers what copy/delete/export/bulk-edit affects. It is separate from
//      the cursor that keyboard navigation moves.
//   4. Row activation gestures are configured here, while application
//      reactions stay outside the configuration. Runtime subscriptions expose
//      state; runtime events report semantic activation commands.
//
// `interaction.mode` owns keyboard routing for the runtime's lifetime. A
// checkbox or row selector may change row selection, but it never changes
// whether ArrowUp moves a cell or a row.
//
// The presets at the bottom are named examples of these primitives. The
// runtime does not branch on a preset identity, and consumers may define a
// custom `GridInteractionConfig` when none of the examples fits.
//
// Vocabulary:
//
//   - cursor: where the next navigation action starts.
//   - active row: the row carrying row-level context.
//   - selection: the cells or rows targeted by an operation.
//   - scope: the GridPaths included by an operation. Config describes behavior
//     inside one path; the caller decides how to aggregate multiple paths.

// ---------------------------------------------------------------------------
// Row operation selection
// ---------------------------------------------------------------------------

export type RowSelectionMode = "single" | "range" | "multi";

// A row-selection control reduces platform input to one of three stable
// meanings. Replace starts a new operation selection. Extend keeps the current
// path's anchor. Toggle changes one row's membership while preserving selected
// rows in other materialized child tables.
export type RowSelectionGesture = "replace" | "extend" | "toggle";

// Row selection can either be derived from the active row or stored
// independently. "Follows active row" is deliberately read-only at the
// storage layer: the effective selected rows are computed from the active row,
// and controller.rowSelection is ignored. Shift+Space toggles an independent
// selection from the current cell or row cursor.
export type SelectedRowsSync =
  { readonly kind: "follows-active-row" } | { readonly kind: "independent" };

export type SelectedRowsConfig =
  | { readonly kind: "none" }
  | {
      readonly kind: "enabled";
      // Controls which shapes may be stored after normalization. Even in
      // "multi", helper functions project the value through displayed-row
      // order, so callers never depend on Set insertion order.
      readonly mode: RowSelectionMode;
      readonly sync: SelectedRowsSync;
    };

export type SelectedCellsConfig =
  { readonly kind: "none" } | { readonly kind: "range" };

// ---------------------------------------------------------------------------
// Cell-first navigation
// ---------------------------------------------------------------------------

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
  | {
      readonly kind: "from-active-cell";
      /** Semantic row activation is disabled when omitted. */
      readonly activation?: RowActivationConfig;
    };

// ---------------------------------------------------------------------------
// Row-first navigation
// ---------------------------------------------------------------------------

export type RowActivationGesture = "enter" | "click" | "doubleClick";

export type RowActivationTrigger =
  | { readonly kind: "keyboard"; readonly gesture: "enter" }
  | {
      readonly kind: "pointer";
      readonly gesture: "click" | "doubleClick";
    };

/** Renderer-neutral pointer input used before a semantic activation exists. */
export type GridPointerInput = {
  readonly gesture: "click" | "doubleClick";
  readonly button: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
};

export type RowActivationConfig = {
  readonly startsOn: readonly RowActivationGesture[];
};

export type ActiveRowKeyboardConfig = {
  readonly arrows: "move-active-row";
  readonly shiftArrows: "extend-selected-rows" | "move-active-row";
  /** Enabled expansion uses Space to toggle and Left/Right to collapse/expand. */
  readonly expansion: "enabled" | "none";
};

export type RowListActiveRowConfig = {
  readonly kind: "from-row-cursor";
  // Row-list keyboard policy belongs to the active row, because the row cursor
  // is the thing arrows move. Selection only participates when Shift+arrows
  // are explicitly configured to extend independent selected rows.
  readonly keyboard: ActiveRowKeyboardConfig;
  /** Semantic row activation is disabled when omitted. */
  readonly activation?: RowActivationConfig;
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
  CellGridInteractionConfig | RowListInteractionConfig;

// ---------------------------------------------------------------------------
// Cell-first presets
// ---------------------------------------------------------------------------

/** Spreadsheet-style editing with rectangular cell selection. */
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

/** Spreadsheet-style editing with one active cell and no cell range. */
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

/** Cell-first navigation that also exposes the active cell's row as context. */
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

/**
 * Cell-first navigation with a separate multi-row operation selection. Moving
 * the active cell does not replace the selected rows.
 */
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
  },
} satisfies GridInteractionConfig;

/**
 * Cell-first navigation with independent multi-row selection whose rows also
 * emit a semantic activation on plain click. The click still places the cell
 * cursor first, so spreadsheet behavior is unchanged; the activation event is
 * additional context for an application that reacts to it (for example, a
 * record detail surface on touch layouts). Enter stays reserved for cell
 * editing, so no keyboard gesture is added.
 */
export const CELL_GRID_WITH_ROW_CLICK_ACTIVATION = {
  ...CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  activeRow: {
    kind: "from-active-cell",
    activation: { startsOn: ["click"] },
  },
} satisfies GridInteractionConfig;

/**
 * Cell-first navigation where the active cell's row is also the single
 * operation target. The name describes a common use, but this preset renders
 * no panel.
 */
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
  },
} satisfies GridInteractionConfig;

/**
 * Cell-first navigation with one independently chosen row operation target.
 * The name describes a common use, but this preset renders no panel.
 */
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
  },
} satisfies GridInteractionConfig;

// ---------------------------------------------------------------------------
// Row-first presets
// ---------------------------------------------------------------------------

/**
 * Full-row navigation with the active row as the single operation target.
 * Arrow keys change active-row context. Space and the horizontal arrow keys
 * control hierarchical expansion.
 * Despite its historical name, this preset creates no detail view or layout.
 */
export const ROW_PRIMARY_MASTER_DETAIL = {
  mode: "row-list",
  activeCell: { kind: "none" },
  selectedCells: { kind: "none" },
  activeRow: {
    kind: "from-row-cursor",
    keyboard: {
      arrows: "move-active-row",
      shiftArrows: "move-active-row",
      expansion: "enabled",
    },
  },
  selectedRows: {
    kind: "enabled",
    mode: "single",
    sync: { kind: "follows-active-row" },
  },
} satisfies GridInteractionConfig;

/**
 * Full-row navigation with semantic activation on Enter and double-click.
 * Left and right retain hierarchical expansion; Enter is reserved for the
 * application activation command.
 */
export const ROW_PRIMARY_MASTER_DETAIL_WITH_ACTIVATION = {
  ...ROW_PRIMARY_MASTER_DETAIL,
  activeRow: {
    ...ROW_PRIMARY_MASTER_DETAIL.activeRow,
    activation: { startsOn: ["enter", "doubleClick"] },
  },
} satisfies GridInteractionConfig;

/**
 * Full-row navigation with independent multi-row operation selection.
 * Shift+Space toggles a row and Shift+arrows extends the selection.
 */
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
  },
} satisfies GridInteractionConfig;
