import { describe, expect, it, vi } from "vitest";
import {
  childPath,
  makeRowId,
  rootPath,
  rowKeyOfRowId,
  type GridPath,
  type GridRuntime,
  type LevelRow,
  type RowId,
} from "@sapporta/grid";
import {
  deleteSelectedTableRows,
  selectedTableDeleteTargets,
} from "./table-selection";

describe("table selection", () => {
  it("collects persisted selected rows across registered paths child-first", () => {
    const root = rootPath("orders");
    const lines = childPath(root, "10" as never, "orders.lines");
    const orderRow = makeRowId(root, "10" as never);
    const lineRow = makeRowId(lines, "501" as never);
    const footerRow = makeRowId(lines, "total" as never);

    const session = makeSession({
      paths: [root, lines],
      selectedByPath: new Map([
        [root, [orderRow]],
        [lines, [footerRow, lineRow]],
      ]),
      dataRowIds: new Set([orderRow, lineRow]),
    });

    expect(selectedTableDeleteTargets(session)).toEqual([
      { path: lines, rowKey: "501" },
      { path: root, rowKey: "10" },
    ]);
  });

  it("does not expose cell-range operation targets as selected rows", () => {
    const root = rootPath("orders");
    const rowId = makeRowId(root, "10" as never);
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map(),
      operationTargetIdsByPath: new Map([[root, [rowId]]]),
      dataRowIds: new Set([rowId]),
    });

    expect(selectedTableDeleteTargets(session)).toEqual([]);
  });

  it("removes selected rows through the grid runtime and clears selection after success", async () => {
    const root = rootPath("orders");
    const rowId = makeRowId(root, "10" as never);
    const clearRowSelection = vi.fn();
    const removeRow = vi.fn(async () => {});
    const continuation = { kind: "grid" as const, path: root };
    const planCursorContinuationForRowRemoval = vi.fn(() => continuation);
    const applyCursorContinuation = vi.fn();
    const refetch = vi.fn();
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map([[root, [rowId]]]),
      dataRowIds: new Set([rowId]),
      clearRowSelection,
      removeRow,
      planCursorContinuationForRowRemoval,
      applyCursorContinuation,
      refetchByPath: new Map([[root, refetch]]),
    });

    await deleteSelectedTableRows(session);

    expect(planCursorContinuationForRowRemoval).toHaveBeenCalledWith([
      { path: root, rowId },
    ]);
    expect(applyCursorContinuation).toHaveBeenCalledWith(continuation);
    expect(applyCursorContinuation.mock.invocationCallOrder[0]).toBeLessThan(
      removeRow.mock.invocationCallOrder[0],
    );
    expect(removeRow).toHaveBeenCalledWith(root, "10");
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(clearRowSelection).toHaveBeenCalledWith(root);
  });

  it("does not complete the deletion workflow until affected paths settle", async () => {
    const root = rootPath("orders");
    const rowId = makeRowId(root, "10" as never);
    const clearRowSelection = vi.fn();
    let resolveRefetch: (() => void) | undefined;
    const refetch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefetch = resolve;
        }),
    );
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map([[root, [rowId]]]),
      dataRowIds: new Set([rowId]),
      clearRowSelection,
      refetchByPath: new Map([[root, refetch]]),
    });

    const deleting = deleteSelectedTableRows(session);
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(clearRowSelection).not.toHaveBeenCalled();

    resolveRefetch?.();
    await deleting;

    expect(clearRowSelection).toHaveBeenCalledWith(root);
  });

  it("deletes selected child rows before parents and refetches every touched path", async () => {
    const root = rootPath("orders");
    const lines = childPath(root, "10" as never, "orders.lines");
    const orderRow = makeRowId(root, "10" as never);
    const lineRow = makeRowId(lines, "501" as never);
    const removeRow = vi.fn(async () => {});
    const refetchRoot = vi.fn();
    const refetchLines = vi.fn();
    const session = makeSession({
      paths: [root, lines],
      selectedByPath: new Map([
        [root, [orderRow]],
        [lines, [lineRow]],
      ]),
      dataRowIds: new Set([orderRow, lineRow]),
      removeRow,
      refetchByPath: new Map([
        [root, refetchRoot],
        [lines, refetchLines],
      ]),
    });

    await deleteSelectedTableRows(session);

    expect(removeRow.mock.calls).toEqual([
      [lines, "501"],
      [root, "10"],
    ]);
    expect(refetchLines).toHaveBeenCalledTimes(1);
    expect(refetchRoot).toHaveBeenCalledTimes(1);
  });

  it("stops after a failure, reports it, and retains rows that remain for retry", async () => {
    const root = rootPath("orders");
    const firstRow = makeRowId(root, "10" as never);
    const failingRow = makeRowId(root, "20" as never);
    const unattemptedRow = makeRowId(root, "30" as never);
    const dataRowIds = new Set([firstRow, failingRow, unattemptedRow]);
    const clearRowSelection = vi.fn();
    const setErrorBanner = vi.fn();
    const refetch = vi.fn();
    const removeRow = vi.fn(async (_path: GridPath, rowKey: string) => {
      if (rowKey === "10") {
        dataRowIds.delete(firstRow);
        return;
      }
      throw new Error("permission denied");
    });
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map([[root, [firstRow, failingRow, unattemptedRow]]]),
      dataRowIds,
      clearRowSelection,
      removeRow,
      setErrorBanner,
      refetchByPath: new Map([[root, refetch]]),
    });

    await deleteSelectedTableRows(session);

    expect(removeRow.mock.calls).toEqual([
      [root, "10"],
      [root, "20"],
    ]);
    expect(clearRowSelection).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: permission denied",
    );
    expect(selectedTableDeleteTargets(session)).toEqual([
      { path: root, rowKey: "20" },
      { path: root, rowKey: "30" },
    ]);
  });
});

function makeSession(args: {
  paths: GridPath[];
  selectedByPath: Map<GridPath, RowId[]>;
  operationTargetIdsByPath?: Map<GridPath, RowId[]>;
  dataRowIds: Set<RowId>;
  clearRowSelection?: (path: GridPath) => void;
  removeRow?: GridRuntime["removeRow"];
  planCursorContinuationForRowRemoval?: GridRuntime["planCursorContinuationForRowRemoval"];
  applyCursorContinuation?: GridRuntime["applyCursorContinuation"];
  setErrorBanner?: (message: string | null) => void;
  refetchByPath?: Map<GridPath, ReturnType<typeof vi.fn>>;
}): {
  runtime: GridRuntime;
  setErrorBanner: (message: string | null) => void;
} {
  const clearRowSelection = args.clearRowSelection ?? vi.fn();
  const refetchByPath =
    args.refetchByPath ??
    new Map(args.paths.map((path) => [path, vi.fn()] as const));
  return {
    setErrorBanner: args.setErrorBanner ?? vi.fn(),
    runtime: {
      registeredPaths: () => args.paths,
      rowOperationTargetsFor: (path: GridPath) =>
        (
          args.operationTargetIdsByPath?.get(path) ??
          args.selectedByPath.get(path) ??
          []
        ).map((rowId) => ({
          path,
          rowId,
          rowKey: rowKeyOfRowId(rowId),
          row: displayedRowFor(args.dataRowIds, rowId),
        })),
      rowInteractionSnapshotFor: (path: GridPath) => ({
        activeRowId: null,
        selectedRowIds: args.selectedByPath.get(path) ?? [],
        statusByRowId: new Map(),
      }),
      displayedRowFor: (_path: GridPath, rowId: RowId) =>
        displayedRowFor(args.dataRowIds, rowId),
      rowInteraction: { clearRowSelection },
      planCursorContinuationForRowRemoval:
        args.planCursorContinuationForRowRemoval ??
        vi.fn(() => ({ kind: "grid", path: args.paths[0] })),
      applyCursorContinuation: args.applyCursorContinuation ?? vi.fn(() => {}),
      removeRow: args.removeRow ?? vi.fn(async () => {}),
      sourceFor: (path: GridPath) => ({
        query: { refetch: refetchByPath.get(path) },
      }),
    } as unknown as GridRuntime,
  };
}

function displayedRowFor(dataRowIds: Set<RowId>, rowId: RowId): LevelRow {
  if (dataRowIds.has(rowId)) {
    return {
      kind: "data",
      id: rowId,
      rowSelectable: true,
      columns: {},
      hasChildren: false,
      source: { levelName: "test", columns: {} },
    };
  }
  return {
    kind: "footer",
    id: rowId,
    rowSelectable: false,
    columns: {},
    source: { rowKey: rowKeyOfRowId(rowId), columns: {} },
  };
}
