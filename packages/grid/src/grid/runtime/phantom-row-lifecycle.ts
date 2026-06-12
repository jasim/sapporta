import type {
  CellCursor,
  ColId,
  GridPath,
  RowId,
  RowKey,
} from "../types/identity";
import {
  displayedPhantomRowKey,
  makeRowId,
  phantomKeyFromDisplayedRowId,
} from "../types/identity";
import type { LevelDataSource } from "../data-sources/types";
import type { LevelSchema } from "../types/schema";
import type { PhantomRow, PhantomRowsConfig } from "../types/level-row";

export type PhantomRowLifecycle = {
  ensureBlankForEmptyPath: (path: GridPath) => PhantomRow | null;
  boundaryCellTarget: (
    path: GridPath,
    colId: ColId,
    colPolicy: "preserve" | "first" | "last",
  ) => CellCursor | null;
  boundaryRowTarget: (
    path: GridPath,
  ) => { path: GridPath; rowId: RowId } | null;
  onCellCursorChanging: (
    previous: CellCursor | null,
    next: CellCursor | null,
  ) => void;
  onRowCursorChanging: (
    previous: { path: GridPath; rowId: RowId } | null,
    next: { path: GridPath; rowId: RowId } | null,
  ) => void;
  setPhantomCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  isBlank: (columns: Record<ColId, unknown>) => boolean;
};

export type PhantomRowLifecycleDeps = {
  config: PhantomRowsConfig | undefined;
  getSource: (path: GridPath) => LevelDataSource | undefined;
  schemaAt: (path: GridPath) => LevelSchema;
  getPhantoms: (path: GridPath) => readonly PhantomRow[];
  addPhantom: (path: GridPath, phantom: PhantomRow) => void;
  setPhantomCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  setPhantomState: (
    path: GridPath,
    rowKey: RowKey,
    state: PhantomRow["state"],
  ) => void;
  commitPhantomRow: (path: GridPath, rowKey: RowKey) => void;
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
    if (!source || !source.writable) return false;
    if (source.snapshot().status !== "ready") return false;
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
    if (!source || source.snapshot().nodes.length !== 0) return null;
    return ensureBlankPhantom(path);
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
      rowId: makeRowId(path, displayedPhantomRowKey(phantom.rowKey)),
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
      rowId: makeRowId(path, displayedPhantomRowKey(phantom.rowKey)),
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
    boundaryCellTarget,
    boundaryRowTarget,
    onCellCursorChanging: onCursorChanging,
    onRowCursorChanging: onCursorChanging,
    setPhantomCell,
    isBlank,
  };
}

export function defaultIsBlank(columns: Record<ColId, unknown>): boolean {
  return Object.values(columns).every(
    (value) => value === null || value === undefined || value === "",
  );
}
