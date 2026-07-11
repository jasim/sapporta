import type {
  CellChange,
  CreateNodeResult,
  RuntimeLevelDataSource,
} from "../data-sources/types";
import type { ColId, Coord, GridPath, RowId, RowKey } from "../types/identity";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  LevelRow,
  PhantomRow,
  TreeNode,
} from "../types/level-row";
import type {
  RowCursor,
  RowInteractionSnapshot,
  RowSelection,
} from "../types/row-selection";
import type { LevelSchema } from "../types/schema";
import type { RowOperationTarget } from "./row-operations";

/**
 * The public runtime for one registered grid path.
 *
 * Static fields remain readable after the level is unregistered. Dynamic
 * reads and commands are lifetime-guarded by the owning GridRuntime.
 */
export type GridLevelRuntime = {
  readonly path: GridPath;
  readonly schema: LevelSchema;
  readonly data: RuntimeLevelDataSource;

  displayedRows(): DisplayedRows;
  displayedRowSequence(): DisplayedRowSequence;
  displayedRow(rowId: RowId): LevelRow | undefined;
  dataRowTarget(rowId: RowId): RowOperationTarget<"data"> | undefined;
  subscribeDisplayedRowSequence(listener: () => void): () => void;
  subscribeDisplayedRow(rowId: RowId, listener: () => void): () => void;

  activeRow(): RowCursor | null;
  selectedRows(): RowSelection;
  selectedRowIds(): readonly RowId[];
  rowInteractionSnapshot(): RowInteractionSnapshot;
  subscribeActiveRow(listener: () => void): () => void;
  subscribeSelectedRows(listener: () => void): () => void;
  subscribeSelectedRowIds(listener: () => void): () => void;
  subscribeRowInteractionSnapshot(listener: () => void): () => void;

  selectRow(rowId: RowId): void;
  setRowSelection(selection: RowSelection): void;
  toggleRowSelection(rowId: RowId): void;
  extendRowSelectionTo(rowId: RowId): void;
  clearRowSelection(): void;

  isExpanded(rowId: RowId): boolean;
  subscribeExpansion(listener: () => void): () => void;
  expand(rowId: RowId): void;
  collapse(rowId: RowId): void;
  toggleExpand(rowId: RowId): void;

  writeCell(coord: Coord, value: unknown): void;
  applyChanges(changes: readonly CellChange[]): void;
  createRow(node: TreeNode, atIndex?: number): Promise<CreateNodeResult>;
  removeRow(rowKey: RowKey): Promise<void>;

  readonly drafts: {
    get(): readonly PhantomRow[];
    subscribe(listener: () => void): () => void;
    add(rowKey: RowKey, columns?: Readonly<Record<ColId, unknown>>): void;
    remove(rowKey: RowKey): void;
    setCell(rowKey: RowKey, colId: ColId, value: unknown): void;
    commit(rowKey: RowKey, atIndex?: number): Promise<CreateNodeResult>;
  };
};

/** Package-private construction ports. */
export type GridLevelRuntimePorts = Omit<
  GridLevelRuntime,
  "path" | "schema" | "data" | "drafts"
> & {
  readonly drafts: GridLevelRuntime["drafts"];
};

const disposersByLevel = new WeakMap<GridLevelRuntime, () => void>();

export function disposeGridLevelRuntime(level: GridLevelRuntime): void {
  disposersByLevel.get(level)?.();
}

export function createGridLevelRuntime(args: {
  readonly path: GridPath;
  readonly schema: LevelSchema;
  readonly data: RuntimeLevelDataSource;
  readonly ports: GridLevelRuntimePorts;
  readonly assertLive: () => void;
  readonly isLive: () => boolean;
  readonly onObserverError: (error: unknown) => void;
}): GridLevelRuntime {
  const subscriptions = new Set<() => void>();

  function trackSubscription(unsubscribe: () => void): () => void {
    let active = true;
    const tracked = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(tracked);
      try {
        unsubscribe();
      } catch (error) {
        args.onObserverError(error);
      }
    };
    subscriptions.add(tracked);
    return tracked;
  }

  function command<Args extends readonly unknown[], Result>(
    run: (...values: Args) => Result,
  ): (...values: Args) => Result {
    return (...values) => {
      args.assertLive();
      return run(...values);
    };
  }

  function asyncCommand<Args extends readonly unknown[], Result>(
    run: (...values: Args) => Promise<Result>,
  ): (...values: Args) => Promise<Result> {
    return (...values) => {
      try {
        args.assertLive();
        return run(...values);
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }

  function subscription<Args extends readonly unknown[]>(
    subscribe: (...values: [...Args, listener: () => void]) => () => void,
  ): (...values: [...Args, listener: () => void]) => () => void {
    return (...values) => {
      args.assertLive();
      const listener = values[values.length - 1] as () => void;
      const leading = values.slice(0, -1) as unknown as Args;
      return trackSubscription(
        subscribe(...leading, () => {
          if (args.isLive()) listener();
        }),
      );
    };
  }

  const drafts = args.ports.drafts;
  const level = Object.freeze({
    path: args.path,
    schema: args.schema,
    data: args.data,
    displayedRows: command(args.ports.displayedRows),
    displayedRowSequence: command(args.ports.displayedRowSequence),
    displayedRow: command(args.ports.displayedRow),
    dataRowTarget: command(args.ports.dataRowTarget),
    subscribeDisplayedRowSequence: subscription(
      args.ports.subscribeDisplayedRowSequence,
    ),
    subscribeDisplayedRow: subscription(args.ports.subscribeDisplayedRow),
    activeRow: command(args.ports.activeRow),
    selectedRows: command(args.ports.selectedRows),
    selectedRowIds: command(args.ports.selectedRowIds),
    rowInteractionSnapshot: command(args.ports.rowInteractionSnapshot),
    subscribeActiveRow: subscription(args.ports.subscribeActiveRow),
    subscribeSelectedRows: subscription(args.ports.subscribeSelectedRows),
    subscribeSelectedRowIds: subscription(args.ports.subscribeSelectedRowIds),
    subscribeRowInteractionSnapshot: subscription(
      args.ports.subscribeRowInteractionSnapshot,
    ),
    selectRow: command(args.ports.selectRow),
    setRowSelection: command(args.ports.setRowSelection),
    toggleRowSelection: command(args.ports.toggleRowSelection),
    extendRowSelectionTo: command(args.ports.extendRowSelectionTo),
    clearRowSelection: command(args.ports.clearRowSelection),
    isExpanded: command(args.ports.isExpanded),
    subscribeExpansion: subscription(args.ports.subscribeExpansion),
    expand: command(args.ports.expand),
    collapse: command(args.ports.collapse),
    toggleExpand: command(args.ports.toggleExpand),
    writeCell: command(args.ports.writeCell),
    applyChanges: command(args.ports.applyChanges),
    createRow: asyncCommand(args.ports.createRow),
    removeRow: asyncCommand(args.ports.removeRow),
    drafts: Object.freeze({
      get: command(drafts.get),
      subscribe: subscription(drafts.subscribe),
      add: command(drafts.add),
      remove: command(drafts.remove),
      setCell: command(drafts.setCell),
      commit: asyncCommand(drafts.commit),
    }),
  });
  disposersByLevel.set(level, () => {
    for (const unsubscribe of Array.from(subscriptions)) unsubscribe();
  });
  return level;
}
