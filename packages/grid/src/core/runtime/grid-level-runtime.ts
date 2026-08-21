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
  /** The dynamic location of this level in the expanded grid hierarchy. */
  readonly path: GridPath;
  /** The static level definition selected by the path's final level name. */
  readonly schema: LevelSchema;
  /**
   * The level's source state, query commands, and reconciliation events.
   * Writes stay on this level runtime so every write uses runtime validation
   * and host events.
   */
  readonly data: RuntimeLevelDataSource;

  /** Reads the complete row model for interaction or imperative work. */
  displayedRows(): DisplayedRows;
  /** Reads the ordered row identities used to mount and reorder row shells. */
  displayedRowSequence(): DisplayedRowSequence;
  /** Reads one displayed row without subscribing to every row in the level. */
  displayedRow(rowId: RowId): LevelRow | undefined;
  /**
   * Issues a current, source-backed target for a later row operation.
   * The result is absent for a stale id or a non-data row.
   */
  dataRowTarget(rowId: RowId): RowOperationTarget<"data"> | undefined;
  /**
   * Observes changes to the complete displayed rows for this level.
   *
   * Use this with `displayedRows()` when a calculation depends on several
   * visible rows. Components concerned with row order or one row should prefer
   * the narrower subscriptions below.
   */
  subscribeDisplayedRows(listener: () => void): () => void;
  /**
   * Observes additions, removals, reordering, and row-kind changes.
   * Cell-content changes do not wake this subscription when row refs stay the
   * same.
   */
  subscribeDisplayedRowSequence(listener: () => void): () => void;
  /** Observes content or capability changes for one displayed row. */
  subscribeDisplayedRow(rowId: RowId, listener: () => void): () => void;

  /** Reads the row that currently drives active-row behavior on this path. */
  activeRow(): RowCursor | null;
  /** Reads the configured row-selection value before displayed-order projection. */
  selectedRows(): RowSelection;
  /** Reads selected row ids in current displayed order. */
  selectedRowIds(): readonly RowId[];
  /** Reads active and selected status for all affected rows in one snapshot. */
  rowInteractionSnapshot(): RowInteractionSnapshot;
  /** Observes active-row changes and ignores unrelated cursor changes. */
  subscribeActiveRow(listener: () => void): () => void;
  /**
   * Observes the configured selection value. It follows active-row changes
   * when selection is derived, and stored row selection when it is independent.
   */
  subscribeSelectedRows(listener: () => void): () => void;
  /**
   * Observes the selected-id projection. Displayed-row changes can wake this
   * subscription even when the selection value itself did not change.
   */
  subscribeSelectedRowIds(listener: () => void): () => void;
  /** Observes the combined active/selected row decoration snapshot. */
  subscribeRowInteractionSnapshot(listener: () => void): () => void;

  /** Replaces independent row selection with one row. */
  selectRow(rowId: RowId): void;
  /** Writes a row-selection value after normalizing it against displayed rows. */
  setRowSelection(selection: RowSelection): void;
  /** Adds or removes one row from independent row selection. */
  toggleRowSelection(rowId: RowId): void;
  /** Extends independent row selection to a displayed row. */
  extendRowSelectionTo(rowId: RowId): void;
  /** Clears stored independent row selection for this path. */
  clearRowSelection(): void;

  /** Reads whether this path currently renders the named row as expanded. */
  isExpanded(rowId: RowId): boolean;
  /** Observes expansion changes on this path only. */
  subscribeExpansion(listener: () => void): () => void;
  /**
   * Registers missing child levels before publishing the expanded state.
   * Calling this for an already expanded row is a no-op.
   */
  expand(rowId: RowId): void;
  /** Hides child levels while retaining their registered resources. */
  collapse(rowId: RowId): void;
  /** Applies `expand` or `collapse` from the current expansion state. */
  toggleExpand(rowId: RowId): void;

  /** Writes one data cell, or one draft cell when the row is a draft. */
  writeCell(coord: Coord, value: unknown): void;
  /** Sends one source-owned batch and emits one committed-mutation event. */
  applyChanges(changes: readonly CellChange[]): void;
  /** Creates a source row after validating its level and row identity. */
  createRow(node: TreeNode, atIndex?: number): Promise<CreateNodeResult>;
  /** Removes one current data row and preserves a valid cursor landing. */
  removeRow(rowKey: RowKey): Promise<void>;

  readonly drafts: {
    /** Reads the current draft rows for this path. */
    get(): readonly PhantomRow[];
    /** Observes draft additions, edits, state changes, and removals. */
    subscribe(listener: () => void): () => void;
    /** Adds an editing draft. The path must be ready and writable. */
    add(rowKey: RowKey, columns?: Readonly<Record<ColId, unknown>>): void;
    /** Removes a draft without changing source data. */
    remove(rowKey: RowKey): void;
    /** Edits a draft and returns a failed draft to the editing state. */
    setCell(rowKey: RowKey, colId: ColId, value: unknown): void;
    /**
     * Creates a source row from a non-blank draft. Concurrent calls for the
     * same draft share one pending promise.
     */
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
const subscriptionTrackersByLevel = new WeakMap<
  GridLevelRuntime,
  (unsubscribe: () => void) => () => void
>();

export function disposeGridLevelRuntime(level: GridLevelRuntime): void {
  disposersByLevel.get(level)?.();
}

/** Package-private bridge for advanced facades tied to a level registration. */
export function trackGridLevelSubscription(
  level: GridLevelRuntime,
  unsubscribe: () => void,
): () => void {
  const track = subscriptionTrackersByLevel.get(level);
  if (!track) {
    unsubscribe();
    throw new Error("Grid level is no longer registered.");
  }
  return track(unsubscribe);
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
  // Subscriptions belong to this registration, not merely to the path string.
  // A later registration of the same path must not inherit old listeners.
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
          // A source or store can already have copied its observer list when
          // unregistration begins. Suppress that final queued delivery.
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
    subscribeDisplayedRows: subscription(args.ports.subscribeDisplayedRows),
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
  subscriptionTrackersByLevel.set(level, trackSubscription);
  return level;
}
