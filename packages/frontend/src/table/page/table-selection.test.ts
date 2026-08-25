import { describe, expect, it, vi } from "vitest";
import {
  childPath,
  makeRowId,
  rootPath,
  type GridPath,
  type RowRemovalResult,
} from "@sapporta/grid";
import {
  clearTableSelection,
  deleteSelectedTableRows,
  selectedTableDeleteTargets,
  type TableDeleteTarget,
  type TableSelectionSession,
} from "./table-selection";

describe("table selection", () => {
  it("uses the runtime's selected data-target projection without replanning it", () => {
    const root = rootPath("orders");
    const lines = childPath(root, "10", "orders.lines");
    const targets = [dataTarget(root, "10"), dataTarget(lines, "501")];
    const session = makeSession({ targets });

    expect(selectedTableDeleteTargets(session)).toBe(targets);
    expect(
      session.runtime.rowOperations.selectedDataTargets,
    ).toHaveBeenCalledTimes(1);
  });

  it("does not expose a target when the runtime projection is empty", () => {
    const session = makeSession({ targets: [] });

    expect(selectedTableDeleteTargets(session)).toEqual([]);
  });

  it("delegates the complete deletion workflow to rowOperations.remove", async () => {
    const target = dataTarget(rootPath("orders"), "10");
    const remove = vi.fn(async () => complete([target]));
    const session = makeSession({ targets: [target], remove });

    await deleteSelectedTableRows(session);

    expect(remove).toHaveBeenCalledWith([target]);
    expect(session.setErrorBanner).not.toHaveBeenCalled();
  });

  it("settles only after the runtime removal result settles", async () => {
    const target = dataTarget(rootPath("orders"), "10");
    const pending = deferred<RowRemovalResult>();
    const remove = vi.fn(() => pending.promise);
    const session = makeSession({ targets: [target], remove });

    let settled = false;
    const deletion = deleteSelectedTableRows(session).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.resolve(complete([target]));
    await deletion;
    expect(settled).toBe(true);
  });

  it("presents a partial removal error and leaves retry state to the runtime", async () => {
    const root = rootPath("orders");
    const removed = dataTarget(root, "10");
    const failed = dataTarget(root, "20");
    const unattempted = dataTarget(root, "30");
    const remove = vi.fn(async (): Promise<RowRemovalResult> => ({
      kind: "partial",
      removed: [removed],
      failed,
      unattempted: [unattempted],
      error: new Error("permission denied"),
    }));
    const session = makeSession({
      targets: [removed, failed, unattempted],
      remove,
    });

    await deleteSelectedTableRows(session);

    expect(session.setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: permission denied",
    );
  });

  it("presents preflight and disposal errors rejected by the runtime", async () => {
    const target = dataTarget(rootPath("orders"), "10");
    const remove = vi.fn(async (): Promise<RowRemovalResult> => {
      throw new Error("stale row target");
    });
    const session = makeSession({ targets: [target], remove });

    await deleteSelectedTableRows(session);

    expect(session.setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: stale row target",
    );
  });

  it("presents disposal errors raised while projecting selected targets", async () => {
    const session = makeSession({ targets: [] });
    vi.mocked(
      session.runtime.rowOperations.selectedDataTargets,
    ).mockImplementation(() => {
      throw new Error("GridRuntime has been disposed.");
    });

    await deleteSelectedTableRows(session);

    expect(session.setErrorBanner).toHaveBeenCalledWith(
      "Failed to delete row: GridRuntime has been disposed.",
    );
  });

  it("clears explicit row selection through each registered level", () => {
    const selected = selectionLevel([makeRowId(rootPath("orders"), "10")]);
    const empty = selectionLevel([]);
    const session = makeSession({
      targets: [],
      levels: [selected.level, empty.level],
    });

    clearTableSelection(session);

    expect(selected.clear).toHaveBeenCalledTimes(1);
    expect(empty.clear).not.toHaveBeenCalled();
  });
});

type RemoveRows = TableSelectionSession["runtime"]["rowOperations"]["remove"];
type SelectionLevel = ReturnType<
  TableSelectionSession["runtime"]["registeredLevels"]
>[number];

function makeSession(args: {
  targets: readonly TableDeleteTarget[];
  remove?: RemoveRows;
  levels?: readonly SelectionLevel[];
}): TableSelectionSession {
  const remove: RemoveRows =
    args.remove ?? (async (targets) => complete(targets));
  return {
    runtime: {
      rowOperations: {
        selectedDataTargets: vi.fn(() => args.targets),
        remove,
      },
      registeredLevels: () => args.levels ?? [],
      subscribeLevels: () => () => {},
    },
    setErrorBanner: vi.fn(),
  };
}

function dataTarget(path: GridPath, rowKey: string): TableDeleteTarget {
  const rowId = makeRowId(path, rowKey);
  const source = {
    rowKey,
    levelName: "rows",
    columns: { id: rowKey },
  };
  return {
    row: {
      kind: "data",
      id: rowId,
      rowSelectable: true,
      columns: source.columns,
      hasChildren: false,
      source,
    },
  } as unknown as TableDeleteTarget;
}

function complete(removed: readonly TableDeleteTarget[]): RowRemovalResult {
  return { kind: "complete", removed };
}

function selectionLevel(selectedIds: readonly ReturnType<typeof makeRowId>[]): {
  level: SelectionLevel;
  clear: ReturnType<typeof vi.fn>;
} {
  const clear = vi.fn();
  return {
    level: {
      selectedRowIds: () => selectedIds,
      clearRowSelection: clear,
      subscribeRowInteractionSnapshot: () => () => {},
      subscribeDisplayedRowSequence: () => () => {},
    },
    clear,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
