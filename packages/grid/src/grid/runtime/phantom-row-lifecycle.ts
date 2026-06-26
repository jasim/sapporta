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
import type { LevelDataSource, LevelSnapshot } from "../data-sources/types";
import type { LevelSchema } from "../types/schema";
import type { PhantomRow, PhantomRowsConfig } from "../types/level-row";

export type PhantomRowLifecycle = {
  // Empty writable levels should still offer a place to add the first row.
  ensureBlankForEmptyPath: (path: GridPath) => PhantomRow | null;
  // A blank add-row belongs only where a new row can be appended right now.
  reconcileBlankAppendPhantoms: (path: GridPath) => void;
  // Moving past the final cell should land on a reusable add-row when allowed.
  boundaryCellTarget: (
    path: GridPath,
    colId: ColId,
    colPolicy: "preserve" | "first" | "last",
  ) => CellCursor | null;
  // Row-list navigation gets the same add-row behavior without a column.
  boundaryRowTarget: (
    path: GridPath,
  ) => { path: GridPath; rowId: RowId } | null;
  // Leaving a filled add-row saves it as an application row.
  onCellCursorChanging: (
    previous: CellCursor | null,
    next: CellCursor | null,
  ) => void;
  // Row-list focus uses the same save-on-leave rule as cell focus.
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
  // Apps can decide what "blank" means for their own columns.
  isBlank: (columns: Record<ColId, unknown>) => boolean;
};

export type PhantomRowLifecycleDeps = {
  config: PhantomRowsConfig | undefined;
  getSource: (path: GridPath) => LevelDataSource | undefined;
  schemaAt: (path: GridPath) => LevelSchema;
  getPhantoms: (path: GridPath) => readonly PhantomRow[];
  addPhantom: (path: GridPath, phantom: PhantomRow) => void;
  removePhantom: (path: GridPath, rowKey: RowKey) => void;
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
    const snapshot = source.snapshot();
    if (snapshot.status !== "ready") return false;
    if (!isDatasourceAppendBoundary(snapshot)) return false;
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
    const snapshot = source.snapshot();
    reconcileBlankAppendPhantoms(path);
    if (snapshot.status !== "ready") return null;
    if (snapshot.nodes.length !== 0) return null;
    return ensureBlankPhantom(path);
  }

  function reconcileBlankAppendPhantoms(path: GridPath): void {
    if (!lifecycleEnabled) return;
    const source = deps.getSource(path);
    if (!source) return;
    const snapshot = source.snapshot();
    if (snapshot.status === "ready" && isDatasourceAppendBoundary(snapshot)) {
      return;
    }
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
    reconcileBlankAppendPhantoms,
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

function isDatasourceAppendBoundary(snapshot: LevelSnapshot): boolean {
  const pagination = snapshot.pagination;
  if (!pagination) return true;

  const visibleCount = snapshot.nodes.length;
  if (visibleCount === 0) {
    // An empty later page is not a place to append; it means the source window
    // is past real rows. Without a total, the first page is the datasource's
    // only valid empty append location.
    if (pagination.totalCount === undefined) return pagination.page === 0;
    return pagination.page === 0 && pagination.totalCount === 0;
  }

  if (!Number.isFinite(pagination.pageSize)) return true;

  if (pagination.totalCount === undefined) {
    // Without a total, a short page is the only signal that the datasource
    // ended. A full page may still have another page after it.
    return visibleCount < pagination.pageSize;
  }

  // With a total, compare the current page window end to the datasource count,
  // not to the number of rows currently displayed.
  const pageStart = pagination.page * pagination.pageSize;
  return pageStart + visibleCount >= pagination.totalCount;
}
