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
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map([[root, [rowId]]]),
      dataRowIds: new Set([rowId]),
      clearRowSelection,
      removeRow,
    });

    await deleteSelectedTableRows(session);

    expect(removeRow).toHaveBeenCalledWith(root, "10");
    expect(clearRowSelection).toHaveBeenCalledWith(root);
  });

  it("reports delete failures through the table error banner", async () => {
    const root = rootPath("orders");
    const orderRow = makeRowId(root, "10" as never);
    const setErrorBanner = vi.fn();
    const session = makeSession({
      paths: [root],
      selectedByPath: new Map([[root, [orderRow]]]),
      dataRowIds: new Set([orderRow]),
      removeRow: vi.fn(async () => {
        throw new Error("permission denied");
      }),
      setErrorBanner,
    });

    await deleteSelectedTableRows(session);

    expect(setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: permission denied",
    );
  });
});

function makeSession(args: {
  paths: GridPath[];
  selectedByPath: Map<GridPath, RowId[]>;
  operationTargetIdsByPath?: Map<GridPath, RowId[]>;
  dataRowIds: Set<RowId>;
  clearRowSelection?: (path: GridPath) => void;
  removeRow?: GridRuntime["removeRow"];
  setErrorBanner?: (message: string | null) => void;
}): {
  runtime: GridRuntime;
  setErrorBanner: (message: string | null) => void;
} {
  const clearRowSelection = args.clearRowSelection ?? vi.fn();
  const refetch = vi.fn();
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
      removeRow: args.removeRow ?? vi.fn(async () => {}),
      sourceFor: () => ({ refetch }),
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
