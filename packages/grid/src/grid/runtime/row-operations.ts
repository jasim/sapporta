import type {
  DisplayedRows,
  LevelRow,
  LevelRowOfKind,
} from "../types/level-row";
import {
  decomposePath,
  pathOfRowId,
  rowKeyOfRowId,
  type GridPath,
  type RowId,
  type RowKey,
} from "../types/identity";

declare const issuedRowOperationTarget: unique symbol;

export type RowOperationTarget<
  Kind extends LevelRow["kind"] = LevelRow["kind"],
> = Kind extends LevelRow["kind"]
  ? {
      readonly row: LevelRowOfKind<Kind>;
      readonly [issuedRowOperationTarget]: true;
    }
  : never;

export type RowRemovalResult =
  | {
      readonly kind: "complete";
      readonly removed: readonly RowOperationTarget<"data">[];
    }
  | {
      readonly kind: "partial";
      readonly removed: readonly RowOperationTarget<"data">[];
      readonly failed: RowOperationTarget<"data">;
      readonly unattempted: readonly RowOperationTarget<"data">[];
      readonly error: unknown;
    };

export type GridRowOperations = {
  /**
   * Returns operation targets across registered paths. Explicit row selection
   * wins per path; cell-selected rows are the fallback.
   */
  targets(): readonly RowOperationTarget[];
  /** Returns source-backed targets from explicit row selection only. */
  selectedDataTargets(): readonly RowOperationTarget<"data">[];
  /** Validates, orders, and removes targets until complete or one fails. */
  remove(
    targets: readonly RowOperationTarget<"data">[],
  ): Promise<RowRemovalResult>;
};

type IssuedTarget = {
  readonly generation: number;
};

export type RowRemovalCursorToken = object;

export type RowOperationsPorts = {
  readonly registeredPaths: () => readonly GridPath[];
  readonly isRegistered: (path: GridPath) => boolean;
  readonly displayedRows: (path: GridPath) => DisplayedRows;
  readonly selectedRowIds: (path: GridPath) => readonly RowId[];
  readonly cellSelectedRowIds: (path: GridPath) => readonly RowId[];
  readonly membershipGeneration: (
    path: GridPath,
    rowKey: RowKey,
  ) => number | undefined;
  readonly isWritable: (path: GridPath) => boolean;
  readonly removeTarget: (target: RowOperationTarget<"data">) => Promise<void>;
  readonly settleTouchedPaths: (paths: ReadonlySet<GridPath>) => Promise<void>;
  readonly beginCursorContinuation: (
    targets: readonly RowOperationTarget<"data">[],
  ) => RowRemovalCursorToken;
  readonly finishCursorContinuation: (
    token: RowRemovalCursorToken,
    removed: readonly RowOperationTarget<"data">[],
    complete: boolean,
  ) => void;
  readonly runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
};

export type RowOperationsController = {
  readonly public: GridRowOperations;
  targetForKind<Kind extends LevelRow["kind"]>(
    path: GridPath,
    rowId: RowId,
    kind: Kind,
  ): RowOperationTarget<Kind> | undefined;
};

export function createRowOperations(
  ports: RowOperationsPorts,
): RowOperationsController {
  const issuedTargets = new WeakMap<object, IssuedTarget>();
  const emptyTargets: readonly RowOperationTarget[] = Object.freeze([]);
  const emptyDataTargets: readonly RowOperationTarget<"data">[] = Object.freeze(
    [],
  );

  function targetForKind<Kind extends LevelRow["kind"]>(
    path: GridPath,
    rowId: RowId,
    kind: Kind,
  ): RowOperationTarget<Kind> | undefined {
    assertRowIdPath(path, rowId);
    const row = ports.displayedRows(path).rowById.get(rowId);
    if (!row || row.kind !== kind) return undefined;
    const rowKey = rowKeyOfRowId(rowId);
    const generation = ports.membershipGeneration(path, rowKey);
    if (generation === undefined) return undefined;

    const target = Object.freeze({ row }) as RowOperationTarget<Kind>;
    issuedTargets.set(target, { generation });
    return target;
  }

  function targetForCurrentRow(
    path: GridPath,
    rowId: RowId,
  ): RowOperationTarget | undefined {
    assertRowIdPath(path, rowId);
    const row = ports.displayedRows(path).rowById.get(rowId);
    if (!row?.rowSelectable) return undefined;
    const rowKey = rowKeyOfRowId(rowId);
    const target = Object.freeze({ row }) as RowOperationTarget;
    if (row.kind === "data") {
      const generation = ports.membershipGeneration(path, rowKey);
      if (generation === undefined) return undefined;
      issuedTargets.set(target, { generation });
    }
    return target;
  }

  function targets(): readonly RowOperationTarget[] {
    const out: RowOperationTarget[] = [];
    for (const path of ports.registeredPaths()) {
      const selected = targetsFromRowIds(path, ports.selectedRowIds(path));
      if (selected.length > 0) {
        out.push(...selected);
        continue;
      }
      out.push(...targetsFromRowIds(path, ports.cellSelectedRowIds(path)));
    }
    return out.length === 0 ? emptyTargets : Object.freeze(out);
  }

  function selectedDataTargets(): readonly RowOperationTarget<"data">[] {
    const out: RowOperationTarget<"data">[] = [];
    for (const path of ports.registeredPaths()) {
      for (const rowId of ports.selectedRowIds(path)) {
        const target = targetForKind(path, rowId, "data");
        if (target?.row.rowSelectable) out.push(target);
      }
    }
    return out.length === 0 ? emptyDataTargets : Object.freeze(out);
  }

  function targetsFromRowIds(
    path: GridPath,
    rowIds: readonly RowId[],
  ): readonly RowOperationTarget[] {
    if (rowIds.length === 0) return emptyTargets;
    const out: RowOperationTarget[] = [];
    for (const rowId of rowIds) {
      const target = targetForCurrentRow(path, rowId);
      if (target) out.push(target);
    }
    return out.length === 0 ? emptyTargets : out;
  }

  async function remove(
    requested: readonly RowOperationTarget<"data">[],
  ): Promise<RowRemovalResult> {
    return ports.runOperation(async () => {
      const targets = preflight(requested);
      if (targets.length === 0) {
        return { kind: "complete", removed: emptyDataTargets };
      }

      const execution = childFirst(targets);
      // Move the cursor before source writes begin. The visible tree still
      // contains every target, so continuation planning has full context.
      const continuation = ports.beginCursorContinuation(execution);
      const removed: RowOperationTarget<"data">[] = [];
      const touched = new Set<GridPath>();

      for (let index = 0; index < execution.length; index += 1) {
        const target = execution[index];
        const path = pathOfRowId(target.row.id);
        try {
          validateTarget(target);
          touched.add(path);
          await ports.removeTarget(target);
          removed.push(target);
        } catch (error) {
          // Touched sources may refresh asynchronously after removal. Wait for
          // them before deciding whether and where cursor correction is needed.
          await ports.settleTouchedPaths(touched);
          ports.finishCursorContinuation(continuation, removed, false);
          return {
            kind: "partial",
            removed: Object.freeze(removed.slice()),
            failed: target,
            unattempted: Object.freeze(execution.slice(index + 1)),
            error,
          };
        }
      }

      await ports.settleTouchedPaths(touched);
      ports.finishCursorContinuation(continuation, removed, true);
      return {
        kind: "complete",
        removed: Object.freeze(removed.slice()),
      };
    });
  }

  function preflight(
    requested: readonly RowOperationTarget<"data">[],
  ): RowOperationTarget<"data">[] {
    const unique: RowOperationTarget<"data">[] = [];
    const seen = new Set<string>();
    for (const target of requested) {
      validateTarget(target);
      const key = target.row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(target);
    }
    return unique;
  }

  function validateTarget(target: RowOperationTarget<"data">): void {
    const issued = issuedTargets.get(target);
    if (!issued) {
      throw new Error(
        "GridRuntime.rowOperations.remove: target was not issued by this runtime.",
      );
    }
    const rowId = target.row.id;
    const path = pathOfRowId(rowId);
    const rowKey = rowKeyOfRowId(rowId);
    if (!ports.isRegistered(path)) {
      throw new Error("Grid level is no longer registered.");
    }
    const current = ports.displayedRows(path).rowById.get(rowId);
    const generation = ports.membershipGeneration(path, rowKey);
    if (
      !current ||
      current.kind !== "data" ||
      generation !== issued.generation
    ) {
      throw new Error(
        `GridRuntime.rowOperations.remove: stale row target "${rowId}".`,
      );
    }
    if (!ports.isWritable(path)) {
      throw new Error(
        `GridRuntime: source for path "${path}" is readonly — row removal is not available.`,
      );
    }
  }

  function childFirst(
    targets: readonly RowOperationTarget<"data">[],
  ): RowOperationTarget<"data">[] {
    // Descendants run before ancestors so removing a parent cannot dispose a
    // child source before its requested child rows have been removed.
    const registeredOrder = new Map(
      ports.registeredPaths().map((path, index) => [path, index] as const),
    );
    return targets
      .map((target, order) => {
        const rowId = target.row.id;
        const path = pathOfRowId(rowId);
        return {
          target,
          order,
          depth: decomposePath(path).edges.length,
          registeredOrder:
            registeredOrder.get(path) ?? Number.MAX_SAFE_INTEGER,
          displayedOrder:
            ports.displayedRows(path).rowIndexById.get(rowId) ??
            Number.MAX_SAFE_INTEGER,
        };
      })
      .sort(
        (a, b) =>
          b.depth - a.depth ||
          a.registeredOrder - b.registeredOrder ||
          a.displayedOrder - b.displayedOrder ||
          a.order - b.order,
      )
      .map(({ target }) => target);
  }

  return {
    public: Object.freeze({ targets, selectedDataTargets, remove }),
    targetForKind,
  };
}

function assertRowIdPath(path: GridPath, rowId: RowId): void {
  if (pathOfRowId(rowId) === path) return;
  throw new Error(
    `GridRuntime: row "${rowId}" does not belong to path "${path}".`,
  );
}
// Row-operation capabilities and ordered removal.
//
// A RowOperationTarget is more than a row id. It is a capability issued for a
// particular row membership generation in a particular runtime. Commands can
// retain the object across an async confirmation step, while removal still
// rejects it if the row disappeared and another row reused its key.
