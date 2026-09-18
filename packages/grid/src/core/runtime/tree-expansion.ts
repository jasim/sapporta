// Expansion state for tree levels (`LevelSchema.tree`).
//
// Tree expansion is displayed-rows view state, not coordinator state. The
// coordinator's `expansion` map means "this row's child levels are mounted",
// and a row is expanded only while it is in that map. A tree level instead
// starts from a default (usually expanded) and records the rows the user
// flipped:
//
//   expanded(row) = row has children && (defaultExpanded XOR toggled.has(row))
//
// Rows that load later therefore follow the default, and nothing has to
// "expand all" imperatively. Changing this state invalidates the path's
// displayed rows with a `{ type: "view" }` reason.
//
// Two source-driven rules also live here:
//   - A new filter result reveals its matches. A snapshot with context rows
//     is a filtered result. When a filtered result holds a different set of
//     rows than the previous snapshot, every context row is expanded, so each
//     match shows even if the user had collapsed one of its ancestors.
//     Comparing the rows, not only the context rows, matters: filters that
//     match "federal" and then "state" can share the same ancestors.
//   - Toggles for rows that left the snapshot are pruned.
import type { LevelSnapshot } from "../data-sources/types";
import type { DisplayedRowsViewState } from "../displayed-rows";
import {
  makeRowId,
  rowKeyOfRowId,
  type GridPath,
  type RowId,
  type RowKey,
} from "../types/identity";
import type { LevelSchema } from "../types/schema";
import {
  initialTreeExpansion,
  isTreeRowExpanded,
  NO_TREE_TOGGLES,
  treeAncestors,
  type TreeExpansionView,
  type TreeStructure,
} from "../types/tree";
import {
  createObserverList,
  type ObserverList,
} from "../observer-notification";

/** One row whose expansion changed, or every row when `rowId` is `null`. */
export type TreeExpansionChange = {
  readonly rowId: RowId | null;
  readonly expanded: boolean;
};

export type TreeExpansionRuntime = ReturnType<
  typeof createTreeExpansionRuntime
>;

const NO_VIEW_STATE: DisplayedRowsViewState = Object.freeze({});

export function createTreeExpansionRuntime(args: {
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly treeStructure: (path: GridPath) => TreeStructure | null;
  /** Re-derives the path's displayed rows after the view changed. */
  readonly invalidate: (path: GridPath) => void;
  /** Runs after rows were hidden or shown, before listeners are notified. */
  readonly afterChange: (path: GridPath) => void;
  readonly announce: (
    path: GridPath,
    changes: readonly TreeExpansionChange[],
  ) => void;
  readonly onObserverError?: (error: unknown) => void;
}) {
  const views = new Map<GridPath, TreeExpansionView>();
  const viewStates = new Map<GridPath, DisplayedRowsViewState>();
  const resultRowsByPath = new Map<GridPath, string>();
  const listeners = new Map<GridPath, ObserverList<[]>>();

  function isTreePath(path: GridPath): boolean {
    return args.schemaAt(path).tree !== undefined;
  }

  function view(path: GridPath): TreeExpansionView {
    const existing = views.get(path);
    if (existing) return existing;
    const tree = args.schemaAt(path).tree;
    if (!tree) {
      throw new Error(`GridRuntime: path "${path}" is not a tree level.`);
    }
    const initial = initialTreeExpansion(tree);
    views.set(path, initial);
    return initial;
  }

  function setView(path: GridPath, next: TreeExpansionView): void {
    views.set(path, next);
    viewStates.delete(path);
  }

  function viewState(path: GridPath): DisplayedRowsViewState {
    if (!isTreePath(path)) return NO_VIEW_STATE;
    const existing = viewStates.get(path);
    if (existing) return existing;
    const next = Object.freeze({ treeExpansion: view(path) });
    viewStates.set(path, next);
    return next;
  }

  function hasChildren(path: GridPath, rowId: RowId): boolean {
    return (args.treeStructure(path)?.childrenById.get(rowId)?.length ?? 0) > 0;
  }

  function isExpanded(path: GridPath, rowId: RowId): boolean {
    return hasChildren(path, rowId) && isTreeRowExpanded(view(path), rowId);
  }

  // Writes the toggle that makes `rowId` expanded or collapsed, whether or not
  // it has children yet. Returns whether the stored state changed.
  function writeExpanded(
    path: GridPath,
    rowId: RowId,
    expanded: boolean,
  ): boolean {
    const current = view(path);
    if (isTreeRowExpanded(current, rowId) === expanded) return false;
    const toggled = new Set(current.toggled);
    if (toggled.has(rowId)) toggled.delete(rowId);
    else toggled.add(rowId);
    setView(path, Object.freeze({ ...current, toggled }));
    return true;
  }

  function commit(path: GridPath, changes: readonly TreeExpansionChange[]) {
    if (changes.length === 0) return;
    args.invalidate(path);
    args.afterChange(path);
    listeners.get(path)?.notify();
    args.announce(path, changes);
  }

  function setExpanded(path: GridPath, rowId: RowId, expanded: boolean): void {
    // A leaf has nothing to show or hide.
    if (!hasChildren(path, rowId)) return;
    if (writeExpanded(path, rowId, expanded)) {
      commit(path, [{ rowId, expanded }]);
    }
  }

  function toggle(path: GridPath, rowId: RowId): void {
    setExpanded(path, rowId, !isExpanded(path, rowId));
  }

  function setAll(path: GridPath, expanded: boolean): void {
    const current = view(path);
    if (current.defaultExpanded === expanded && current.toggled.size === 0) {
      return;
    }
    setView(
      path,
      Object.freeze({ defaultExpanded: expanded, toggled: NO_TREE_TOGGLES }),
    );
    commit(path, [{ rowId: null, expanded }]);
  }

  function ancestorsOf(path: GridPath, rowId: RowId): RowId[] {
    const structure = args.treeStructure(path);
    return structure ? treeAncestors(structure, rowId) : [];
  }

  function reveal(path: GridPath, rowId: RowId): void {
    const changes: TreeExpansionChange[] = [];
    for (const ancestor of ancestorsOf(path, rowId).reverse()) {
      if (writeExpanded(path, ancestor, true)) {
        changes.push({ rowId: ancestor, expanded: true });
      }
    }
    commit(path, changes);
  }

  function parentOf(path: GridPath, rowId: RowId): RowId | null {
    return args.treeStructure(path)?.parentById.get(rowId) ?? null;
  }

  function childrenOf(path: GridPath, rowId: RowId): readonly RowId[] {
    return args.treeStructure(path)?.childrenById.get(rowId) ?? [];
  }

  // Called with each new source snapshot, before the displayed rows are
  // derived from it. Returns the changes to announce once they are.
  function reconcileSnapshot(
    path: GridPath,
    snapshot: LevelSnapshot,
  ): readonly TreeExpansionChange[] {
    if (!isTreePath(path)) return [];
    const current = view(path);
    if (current.toggled.size > 0) {
      const present = new Set<RowKey>(snapshot.nodes.map((n) => n.rowKey));
      const kept = Array.from(current.toggled).filter((rowId) =>
        present.has(rowKeyOfRowId(rowId)),
      );
      if (kept.length !== current.toggled.size) {
        setView(path, Object.freeze({ ...current, toggled: new Set(kept) }));
      }
    }

    const contextKeys = snapshot.treeContextRowKeys ?? [];
    // The same rows in another order (a new sort) are the same result.
    const signature =
      contextKeys.length === 0
        ? ""
        : snapshot.nodes
            .map((node) => node.rowKey)
            .sort()
            .join("\u0000");
    if (resultRowsByPath.get(path) === signature) return [];
    resultRowsByPath.set(path, signature);
    const changes: TreeExpansionChange[] = [];
    for (const rowKey of contextKeys) {
      const rowId = makeRowId(path, rowKey);
      if (writeExpanded(path, rowId, true)) {
        changes.push({ rowId, expanded: true });
      }
    }
    return changes;
  }

  function announceSnapshotChanges(
    path: GridPath,
    changes: readonly TreeExpansionChange[],
  ): void {
    if (changes.length === 0) return;
    listeners.get(path)?.notify();
    args.announce(path, changes);
  }

  function subscribe(path: GridPath, listener: () => void): () => void {
    let observers = listeners.get(path);
    if (!observers) {
      observers = createObserverList(args.onObserverError);
      listeners.set(path, observers);
    }
    return observers.subscribe(listener);
  }

  function unregister(path: GridPath): void {
    views.delete(path);
    viewStates.delete(path);
    resultRowsByPath.delete(path);
    listeners.get(path)?.clear();
    listeners.delete(path);
  }

  function dispose(): void {
    for (const observers of listeners.values()) observers.clear();
    listeners.clear();
    views.clear();
    viewStates.clear();
    resultRowsByPath.clear();
  }

  return {
    viewState,
    hasChildren,
    isExpanded,
    expand: (path: GridPath, rowId: RowId) => setExpanded(path, rowId, true),
    collapse: (path: GridPath, rowId: RowId) => setExpanded(path, rowId, false),
    toggle,
    expandAll: (path: GridPath) => setAll(path, true),
    collapseAll: (path: GridPath) => setAll(path, false),
    reveal,
    parentOf,
    childrenOf,
    reconcileSnapshot,
    announceSnapshotChanges,
    subscribe,
    unregister,
    dispose,
  };
}
