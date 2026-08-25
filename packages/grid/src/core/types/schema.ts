// Column schema, cell renderers, and cell editors.
//
// The base grid owns mechanics only: layout, focus, selection, editing
// lifecycle, data-source coordination, row identity, and pipeline execution.
// The host owns cell UI. Sapporta's table/admin presentation is an adapter
// built on top of this contract, not a default in the base grid.
//
// Two hard rules for renderers:
//   1. Renderers do not read focus, selection, editing, or active-ness.
//      Focus chrome is CellShell's job. The renderer's output is identical
//      across focus flips — React diff produces zero DOM mutations on click;
//      the only cost is one JS function call.
//   2. Renderers that need live store data return a stateful component.
//      The renderer function runs once per Cell re-render, but the component
//      instance subscribes internally and re-renders on its own subscription,
//      independently of the cell.
//
// Cell editors see `CellEditorProps` — the full surface an editor needs.
// Editors are consumer code. While editing, the controller's key handler
// returns early — the editor's focused element decides what Escape/Enter/Tab mean and calls
// commit/cancel. `commit` is async-tolerant; editors that resolve a
// value via fetch call it after their promise settles.
//
// Editor as singleton overlay: the editing cell does NOT branch into an
// `<EditingCell/>`. Each path's Grid.tsx mounts one `<CellEditorOverlay/>`
// that subscribes to the controller's `editing` state. When non-null, it
// positions itself absolutely over the focused cell and renders the editor.
// Starting an edit doesn't re-render the focused cell — the cell's `status`
// flips from "focus" to "editing" for class purposes only, and the overlay
// mounts in parallel.
//
// `column.edit` declares which gestures can open a supplied editor. Absence
// means the cell cannot enter edit mode. Enter may also be declared by
// `column.activation`: it edits when the focused cell is editable at runtime
// and otherwise runs the activation as that cell's primary action.
// `column.activation` declares which gestures run a cell action. Renderers get
// a narrow activation affordance; keyboard and pointer input are owned by the
// grid.
// `column.meta` is opaque to the grid — consumers use it for FK targets,
// link configs, or anything else. Domain features built on top of the grid
// (FK chips, link adornments, schema-derived context menu entries) are
// consumer-side: they live outside `grid/`, attach data via `column.meta`,
// and supply `renderCell` / `edit` / context-menu contributors.

import type { ComponentType, ReactNode } from "react";
import type { CommitTarget } from "./action";
import type { ColId, Coord, GridPath, RowId } from "./identity";
import type { LevelOptions, LevelRow } from "./level-row";

export type CellEditGesture = "enter" | "type" | "doubleClick";
export type NonTypedCellEditGesture = Exclude<CellEditGesture, "type">;

export type CellEditorStart =
  | {
      readonly trigger: "type";
      readonly typedSeed: string;
    }
  | {
      readonly trigger: NonTypedCellEditGesture;
    };

export const DEFAULT_CELL_EDIT_GESTURES: readonly CellEditGesture[] = [
  "enter",
  "type",
  "doubleClick",
] as const;

export type CellEditBehavior = {
  readonly editor: ComponentType<CellEditorProps>;
  readonly startsOn: readonly CellEditGesture[];
};

export type CellActivationGesture = "enter" | "space" | "click" | "doubleClick";

export type CellAvailability =
  | { readonly kind: "enabled" }
  | { readonly kind: "disabled"; readonly reason?: string };

export type CellActivationState = {
  readonly label: string;
  readonly availability: CellAvailability;
};

export type CellActivationDescription =
  string | ((ctx: CellActivationContext) => CellActivationState);

export type CellActivationTrigger =
  | {
      readonly kind: "keyboard";
      readonly gesture: "enter" | "space";
    }
  | {
      readonly kind: "pointer";
      readonly gesture: "click" | "doubleClick";
    };

export type CellActivationColumnContext = {
  readonly id: ColId;
  readonly name: string;
  readonly meta?: unknown;
};

export type CellActionApi = {
  readonly rowExpansion: {
    canToggle: (target: { path: GridPath; row: LevelRow }) => boolean;
    isExpanded: (target: { path: GridPath; rowId: RowId }) => boolean;
    toggle: (target: { path: GridPath; rowId: RowId }) => void;
  };
};

export type CellActivationContext = {
  readonly trigger: CellActivationTrigger;
  readonly value: unknown;
  readonly row: LevelRow;
  readonly column: CellActivationColumnContext;
  readonly path: GridPath;
  readonly coord: Coord;
  readonly actions: CellActionApi;
};

export type CellActivation = {
  readonly startsOn: readonly CellActivationGesture[];
  readonly describe: CellActivationDescription;
  readonly run: (ctx: CellActivationContext) => void | Promise<void>;
};

export type CellRenderActivation = {
  readonly label: string;
  readonly availability: CellAvailability;
  readonly run: () => void;
};

export type CellRenderProps = {
  readonly value: unknown;
  readonly row: LevelRow;
  readonly column: ColumnSchema;
  readonly path: GridPath;
  /** Whether this cell is also the data-backed row-selection header. */
  readonly rowHeader?: boolean;
  readonly activation: CellRenderActivation | null;
};

export type CellEditorProps = {
  readonly editStart: CellEditorStart;
  readonly value: unknown;
  readonly row: LevelRow;
  readonly column: ColumnSchema;
  readonly path: GridPath;
  readonly anchor: HTMLElement;
  // `commit` tells the controller where focus should land after the write
  // (next/prev/down/stay/…). Editors omit it for "stay" semantics; Tab
  // passes "next"/"prev"; Enter passes "down".
  readonly commit: (newValue: unknown, commit?: CommitTarget) => void;
  readonly cancel: () => void;
};

export type GridCopyColumn<TRow = LevelRow> = {
  readonly header: string;
  readonly valueAt: (row: TRow, rowIndex: number) => unknown;
};

export type GridColumnCopyBehavior = (context: {
  readonly path: GridPath;
  readonly column: ColumnSchema;
  readonly rows: readonly LevelRow[];
}) => readonly GridCopyColumn[] | Promise<readonly GridCopyColumn[]>;

export type ColumnSchema = {
  readonly id: ColId;
  readonly name: string;
  readonly renderCell: (props: CellRenderProps) => ReactNode;
  readonly compare?: (a: unknown, b: unknown) => number;
  readonly edit?: CellEditBehavior;
  readonly activation?: CellActivation;
  readonly copy?: GridColumnCopyBehavior;
  readonly meta?: unknown;
};

export type RowHeaderColumn<ColumnName extends string = ColId> =
  { readonly column: ColumnName } | "empty-selectable-cell" | "none";

export function editStartsOn(
  column: ColumnSchema,
  gesture: CellEditGesture,
): boolean {
  return column.edit?.startsOn.includes(gesture) ?? false;
}

export function activationStartsOn(
  column: ColumnSchema,
  gesture: CellActivationGesture,
): boolean {
  return column.activation?.startsOn.includes(gesture) ?? false;
}

export function describeCellActivation(
  activation: CellActivation,
  context: CellActivationContext,
): CellActivationState {
  if (typeof activation.describe === "string") {
    return {
      label: activation.describe,
      availability: { kind: "enabled" },
    };
  }
  return activation.describe(context);
}

// Level/grid schema — static shape of a grid, separate from data.
//
// `GridSchema` is produced once by the host and passed to `createGridRuntime`.
// It declares which levels exist and how they connect by name. It does NOT
// describe paths — paths emerge from data as `resolveChild` is invoked.
export type LevelSchema = {
  readonly name: string;
  readonly columns: readonly ColumnSchema[];
  readonly rowHeaderColumn: RowHeaderColumn;
  readonly options: LevelOptions;
  // Names of child levels that hang off rows of this level. Order = render
  // order. A leaf level declares no children.
  readonly childLevels: readonly string[];
};

export type GridSchema = {
  readonly levels: Readonly<Record<string, LevelSchema>>;
  readonly rootLevel: string;
};
