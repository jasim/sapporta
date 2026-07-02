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
// means the cell cannot enter edit mode.
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

export type CellEditGesture = "enter" | "f2" | "type" | "doubleClick";
export type NonTypedCellEditGesture = Exclude<CellEditGesture, "type">;

export type CellEditorStart =
  | {
      trigger: "type";
      typedSeed: string;
    }
  | {
      trigger: NonTypedCellEditGesture;
    };

export const DEFAULT_CELL_EDIT_GESTURES: readonly CellEditGesture[] = [
  "enter",
  "f2",
  "type",
  "doubleClick",
] as const;

export type CellEditBehavior = {
  editor: ComponentType<CellEditorProps>;
  startsOn: readonly CellEditGesture[];
};

export type CellActivationGesture = "enter" | "space" | "click" | "doubleClick";

export type CellAvailability =
  | { kind: "enabled" }
  | { kind: "disabled"; reason?: string };

export type CellActivationState = {
  label: string;
  availability: CellAvailability;
};

export type CellActivationDescription =
  | string
  | ((ctx: CellActivationContext) => CellActivationState);

export type CellActivationTrigger =
  | { kind: "keyboard"; gesture: "enter" | "space" }
  | { kind: "pointer"; gesture: "click" | "doubleClick" };

export type CellActivationColumnContext = {
  id: ColId;
  name: string;
  meta?: unknown;
};

export type CellActionApi = {
  rowExpansion: {
    canToggle: (target: { path: GridPath; row: LevelRow }) => boolean;
    isExpanded: (target: { path: GridPath; rowId: RowId }) => boolean;
    toggle: (target: { path: GridPath; rowId: RowId }) => void;
  };
};

export type CellActivationContext = {
  trigger: CellActivationTrigger;
  value: unknown;
  row: LevelRow;
  column: CellActivationColumnContext;
  path: GridPath;
  coord: Coord;
  actions: CellActionApi;
};

export type CellActivation = {
  startsOn: readonly CellActivationGesture[];
  describe: CellActivationDescription;
  run: (ctx: CellActivationContext) => void | Promise<void>;
};

export type CellRenderActivation = {
  label: string;
  availability: CellAvailability;
  run: () => void;
};

export type CellRenderProps = {
  value: unknown;
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
  activation: CellRenderActivation | null;
};

export type CellEditorProps = {
  editStart: CellEditorStart;
  value: unknown;
  row: LevelRow;
  column: ColumnSchema;
  path: GridPath;
  anchor: HTMLElement;
  // `commit` tells the controller where focus should land after the write
  // (next/prev/down/stay/…). Editors omit it for "stay" semantics; Tab
  // passes "next"/"prev"; Enter passes "down".
  commit: (newValue: unknown, commit?: CommitTarget) => void;
  cancel: () => void;
};

export type ColumnSchema = {
  id: ColId;
  name: string;
  renderCell: (props: CellRenderProps) => ReactNode;
  compare?: (a: unknown, b: unknown) => number;
  edit?: CellEditBehavior;
  activation?: CellActivation;
  meta?: unknown;
};

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
  name: string;
  columns: ColumnSchema[];
  options: LevelOptions;
  // Names of child levels that hang off rows of this level. Order = render
  // order. A leaf level declares no children.
  childLevels: string[];
};

export type GridSchema = {
  levels: Record<string, LevelSchema>;
  rootLevel: string;
};
