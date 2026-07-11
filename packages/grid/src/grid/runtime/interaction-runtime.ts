import type { GridControllerStore } from "../interaction/controller";
import type { GridCoordinatorStore } from "../interaction/coordinator";
import type { CursorManagerInternal } from "../interaction/cursor-manager";
import type { GridPath, RowId } from "../types/identity";
import type {
  RowCursor,
  RowInteractionSnapshot,
  RowSelection,
} from "../types/row-selection";
import { reportObserverError } from "../observer-notification";

/** Owns path-local interaction resources and their snapshot identities. */
export function createInteractionRuntime(args: {
  readonly coordinator: GridCoordinatorStore;
  readonly cursorManager: CursorManagerInternal;
  readonly createController: (path: GridPath) => {
    readonly controller: GridControllerStore;
    readonly cleanup: () => void;
  };
  readonly onObserverError?: (error: unknown) => void;
}) {
  // A controller and its cleanup share one path registration. Projection
  // caches contain derived values only and can be dropped at any time.
  const controllers = new Map<GridPath, GridControllerStore>();
  const cleanups = new Map<GridPath, () => void>();
  const activeRows = new Map<GridPath, RowCursor | null>();
  const selectedRows = new Map<GridPath, RowSelection>();
  const selectedRowIds = new Map<GridPath, readonly RowId[]>();
  const rowSnapshots = new Map<GridPath, RowInteractionSnapshot>();

  function controller(path: GridPath): GridControllerStore {
    // Controllers are lazy and identity-stable while the path remains
    // registered. Collapsing a row does not unregister its child paths.
    let existing = controllers.get(path);
    if (existing) return existing;
    const created = args.createController(path);
    controllers.set(path, created.controller);
    cleanups.set(path, created.cleanup);
    return created.controller;
  }

  function unregister(path: GridPath): void {
    // Run subscriptions before dropping state references. Cleanup callbacks
    // may still need the controller they were created from.
    cleanup(cleanups.get(path));
    cleanups.delete(path);
    controllers.delete(path);
    activeRows.delete(path);
    selectedRows.delete(path);
    selectedRowIds.delete(path);
    rowSnapshots.delete(path);
  }

  function dispose(): void {
    for (const path of Array.from(controllers.keys())) unregister(path);
    for (const cleanupFn of cleanups.values()) cleanup(cleanupFn);
    cleanups.clear();
  }

  function cleanup(cleanupFn: (() => void) | undefined): void {
    if (!cleanupFn) return;
    try {
      cleanupFn();
    } catch (error) {
      reportObserverError(error, args.onObserverError);
    }
  }

  return {
    coordinator: args.coordinator,
    cursorManager: args.cursorManager,
    controller,
    activeRows,
    selectedRows,
    selectedRowIds,
    rowSnapshots,
    unregister,
    dispose,
  };
}
// Path-scoped interaction resources.
//
// Controllers hold writable interaction state. The other maps hold memoized
// reader projections. Stable projection identities let subscriptions compare
// what their callers observe instead of notifying for every underlying store
// update.
