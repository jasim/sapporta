import type {
  CellCursor,
  ColId,
  GridPath,
  RowId,
  RowKey,
} from "../types/identity";
import {
  makeLevelRowId,
  phantomKeyFromDisplayedRowId,
} from "../types/identity";
import type { LevelDataSource } from "../data-sources/types";
import type { LevelSchema } from "../types/schema";
import type { PhantomRow, PhantomRowsConfig } from "../types/level-row";

export type PhantomRowLifecycle = {
  // Empty writable levels should still offer a place to add the first row.
  readonly ensureBlankForEmptyPath: (path: GridPath) => PhantomRow | null;
  // A blank add-row belongs only where a new row can be appended right now.
  readonly reconcileBlankAppendPhantoms: (path: GridPath) => void;
  // Moving past the final cell should land on a reusable add-row when allowed.
  readonly boundaryCellTarget: (
    path: GridPath,
    colId: ColId,
    colPolicy: "preserve" | "first" | "last",
  ) => CellCursor | null;
  // Row-list navigation gets the same add-row behavior without a column.
  readonly boundaryRowTarget: (
    path: GridPath,
  ) => { path: GridPath; rowId: RowId } | null;
  // Leaving a filled add-row saves it as an application row.
  readonly onCellCursorChanging: (
    previous: CellCursor | null,
    next: CellCursor | null,
  ) => void;
  // Row-list focus uses the same save-on-leave rule as cell focus.
  readonly onRowCursorChanging: (
    previous: { path: GridPath; rowId: RowId } | null,
    next: { path: GridPath; rowId: RowId } | null,
  ) => void;
  readonly setPhantomCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  // Apps can decide what "blank" means for their own columns.
  readonly isBlank: (columns: Readonly<Record<ColId, unknown>>) => boolean;
};

export type PhantomRowLifecycleDeps = {
  readonly config: PhantomRowsConfig | undefined;
  readonly getSource: (path: GridPath) => LevelDataSource | undefined;
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly getPhantoms: (path: GridPath) => readonly PhantomRow[];
  readonly addPhantom: (path: GridPath, phantom: PhantomRow) => void;
  readonly removePhantom: (path: GridPath, rowKey: RowKey) => void;
  readonly setPhantomCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  readonly setPhantomState: (
    path: GridPath,
    rowKey: RowKey,
    state: PhantomRow["state"],
  ) => void;
  readonly commitPhantomRow: (path: GridPath, rowKey: RowKey) => void;
};

export function createPhantomRowLifecycle(
  deps: PhantomRowLifecycleDeps,
): PhantomRowLifecycle {
  const config = deps.config;
  const lifecycleEnabled = config !== undefined && config !== false;
  const isBlank =
    config === false || config === undefined
      ? defaultIsBlank
      : (config.isBlank ?? defaultIsBlank);

  function eligible(path: GridPath): boolean {
    if (!lifecycleEnabled) return false;
    const source = deps.getSource(path);
    if (!source?.write) return false;
    const state = source.state();
    if (state.status !== "ready") return false;
    // Append eligibility is a source/write decision. A table source can answer
    // from one-based page and total-count state, while a local source can answer
    // from its private window. The lifecycle only needs the boolean: may a
    // blank authoring row be appended to the currently loaded rows?
    if (source.write.canAppendRow?.() !== true) return false;
    return deps.schemaAt(path).options.allowPhantoms === true;
  }

  function blankEditingPhantom(path: GridPath): PhantomRow | null {
    return (
      deps
        .getPhantoms(path)
        .find((row) => row.state.kind === "editing" && isBlank(row.columns)) ??
      null
    );
  }

  function ensureBlankPhantom(path: GridPath): PhantomRow | null {
    reconcileBlankAppendPhantoms(path);
    if (!eligible(path)) return null;
    const existing = blankEditingPhantom(path);
    if (existing) return existing;
    const current = deps.getPhantoms(path);
    const rowKey = makeRowKey(path, current);
    const phantom: PhantomRow = {
      rowKey,
      columns: {},
      state: { kind: "editing" },
    };
    deps.addPhantom(path, phantom);
    return phantom;
  }

  function makeRowKey(path: GridPath, existing: readonly PhantomRow[]): RowKey {
    if (config !== false && config !== undefined && config.makeRowKey) {
      return config.makeRowKey({ path, existing });
    }
    const used = new Set(existing.map((row) => row.rowKey));
    let index = existing.length + 1;
    while (used.has(`draft-${index}`)) index++;
    return `draft-${index}`;
  }

  function ensureBlankForEmptyPath(path: GridPath): PhantomRow | null {
    const source = deps.getSource(path);
    if (!source) return null;
    const state = source.state();
    reconcileBlankAppendPhantoms(path);
    if (state.status !== "ready") return null;
    if (state.snapshot.nodes.length !== 0) return null;
    return ensureBlankPhantom(path);
  }

  function reconcileBlankAppendPhantoms(path: GridPath): void {
    if (!lifecycleEnabled) return;
    const source = deps.getSource(path);
    if (!source) return;
    const state = source.state();
    if (state.status === "ready" && source.write?.canAppendRow?.() === true) {
      return;
    }
    // Only remove blank editing rows. A filled row is user input and should be
    // saved or failed through the normal leave-and-commit path, not deleted
    // because the surrounding source moved out of append position.
    for (const phantom of deps.getPhantoms(path)) {
      if (phantom.state.kind === "editing" && isBlank(phantom.columns)) {
        deps.removePhantom(path, phantom.rowKey);
      }
    }
  }

  function colForPolicy(
    path: GridPath,
    currentColId: ColId,
    policy: "preserve" | "first" | "last",
  ): ColId | null {
    const columns = deps.schemaAt(path).columns;
    if (columns.length === 0) return null;
    if (policy === "first") return columns[0].id;
    if (policy === "last") return columns[columns.length - 1].id;
    return columns.some((column) => column.id === currentColId)
      ? currentColId
      : columns[0].id;
  }

  function boundaryCellTarget(
    path: GridPath,
    colId: ColId,
    colPolicy: "preserve" | "first" | "last",
  ): CellCursor | null {
    const phantom = ensureBlankPhantom(path);
    if (!phantom) return null;
    const targetColId = colForPolicy(path, colId, colPolicy);
    if (!targetColId) return null;
    return {
      path,
      rowId: makeLevelRowId(path, "phantom", phantom.rowKey),
      colId: targetColId,
    };
  }

  function boundaryRowTarget(
    path: GridPath,
  ): { path: GridPath; rowId: RowId } | null {
    const phantom = ensureBlankPhantom(path);
    if (!phantom) return null;
    return {
      path,
      rowId: makeLevelRowId(path, "phantom", phantom.rowKey),
    };
  }

  function onCursorChanging(
    previous: { path: GridPath; rowId: RowId } | null,
    next: { path: GridPath; rowId: RowId } | null,
  ): void {
    if (!previous) return;
    if (next?.path === previous.path && next.rowId === previous.rowId) return;
    const phantomKey = phantomKeyFromDisplayedRowId(previous.rowId);
    if (!phantomKey) return;
    const phantom = deps
      .getPhantoms(previous.path)
      .find((row) => row.rowKey === phantomKey);
    if (!phantom) return;
    if (phantom.state.kind !== "editing") return;
    if (isBlank(phantom.columns)) return;
    deps.commitPhantomRow(previous.path, phantomKey);
  }

  function setPhantomCell(
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ): void {
    const phantom = deps.getPhantoms(path).find((row) => row.rowKey === rowKey);
    if (!phantom) return;
    if (phantom.state.kind === "saving") {
      throw new Error(
        `GridRuntime.writeCell: phantom row "${rowKey}" at path "${path}" is saving and cannot be edited.`,
      );
    }
    if (phantom.state.kind === "failed") {
      deps.setPhantomState(path, rowKey, { kind: "editing" });
    }
    deps.setPhantomCell(path, rowKey, colId, value);
  }

  return {
    ensureBlankForEmptyPath,
    reconcileBlankAppendPhantoms,
    boundaryCellTarget,
    boundaryRowTarget,
    onCellCursorChanging: onCursorChanging,
    onRowCursorChanging: onCursorChanging,
    setPhantomCell,
    isBlank,
  };
}

export function defaultIsBlank(
  columns: Readonly<Record<ColId, unknown>>,
): boolean {
  return Object.values(columns).every(
    (value) => value === null || value === undefined || value === "",
  );
}
