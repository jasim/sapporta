import { describe, expect, it, vi } from "vitest";
import {
  childPath,
  makeRowId,
  rootPath,
  type GridPath,
  type GridRuntime,
  type RowId,
} from "@sapporta/grid";
import {
  deleteSelectedTableToolbarRows,
  selectedTableToolbarDeleteTargets,
  type TableToolbarSession,
} from "./TableToolbarDeleteRowAction";

describe("TableToolbarDeleteRowAction", () => {
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

    expect(selectedTableToolbarDeleteTargets(session)).toEqual([
      { path: lines, rowKey: "501" },
      { path: root, rowKey: "10" },
    ]);
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

    await deleteSelectedTableToolbarRows(session);

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

    await deleteSelectedTableToolbarRows(session);

    expect(setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: permission denied",
    );
  });
});

function makeSession(args: {
  paths: GridPath[];
  selectedByPath: Map<GridPath, RowId[]>;
  dataRowIds: Set<RowId>;
  clearRowSelection?: (path: GridPath) => void;
  removeRow?: GridRuntime["removeRow"];
  setErrorBanner?: TableToolbarSession["setErrorBanner"];
}): TableToolbarSession {
  const clearRowSelection = args.clearRowSelection ?? vi.fn();
  const refetch = vi.fn();
  return {
    setErrorBanner: args.setErrorBanner ?? vi.fn(),
    runtime: {
      registeredPaths: () => args.paths,
      rowInteractionSnapshotFor: (path: GridPath) => ({
        activeRowId: null,
        selectedRowIds: args.selectedByPath.get(path) ?? [],
        statusByRowId: new Map(),
      }),
      displayedRowFor: (_path: GridPath, rowId: RowId) =>
        args.dataRowIds.has(rowId)
          ? ({ kind: "data" } as never)
          : ({ kind: "footer" } as never),
      rowInteraction: { clearRowSelection },
      removeRow: args.removeRow ?? vi.fn(async () => {}),
      sourceFor: () => ({ refetch }),
    } as unknown as GridRuntime,
  };
}
