// Convenience layer for the flat-table host case. Wraps a runtime's
// root level so callers don't resolve it for every call. Holds no state of its
// own — every method delegates to the root level or its private renderer
// controller.
//
// This wrapper exists for the dominant case where the host only cares about
// the root level.
//
// The wrapper is a discriminated union on the root source's write capability
// flag. `rootSource` is always the level's read view and never exposes edit
// verbs; writable roots add draft helpers and commitPhantomRow.

import type { ColId, RowKey } from "../types/identity";
import type { PhantomRow } from "../types/level-row";
import { runtimeInternalsFor, type GridRuntime } from "./create-grid-runtime";
import type { GridControllerPublic } from "../interaction/controller";
import type {
  CreateNodeResult,
  RuntimeLevelDataSource,
} from "../data-sources/types";

// Legacy flat-table draft helpers with the root path already bound.
export type RootPhantomHelpers = {
  get: () => readonly PhantomRow[];
  add: (phantom: PhantomRow) => void;
  remove: (rowKey: RowKey) => void;
  setCell: (rowKey: RowKey, colId: ColId, value: unknown) => void;
  subscribe: (fn: () => void) => () => void;
};

export type ReadonlyTableController = {
  readonly writable: false;
  readonly rootSource: RuntimeLevelDataSource;
  readonly rootController: GridControllerPublic;
};

export type WritableTableController = {
  readonly writable: true;
  readonly rootSource: RuntimeLevelDataSource;
  readonly rootController: GridControllerPublic;
  readonly phantoms: RootPhantomHelpers;
  // Atomic from the host's view; emits `phantomRowCommitted` on success.
  commitPhantomRow: (
    rowKey: RowKey,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
};

export type TableController = ReadonlyTableController | WritableTableController;

export function createTableController(args: {
  runtime: GridRuntime;
}): TableController {
  const { runtime } = args;
  const root = runtime.root;
  const rootSource = root.data;
  const rootController = runtimeInternalsFor(runtime).controllerFor(root.path);

  if (!rootSource.canWrite) {
    return { writable: false, rootSource, rootController };
  }

  const phantoms: RootPhantomHelpers = {
    get: root.drafts.get,
    add: (phantom) => root.drafts.add(phantom.rowKey, phantom.columns),
    remove: root.drafts.remove,
    setCell: root.drafts.setCell,
    subscribe: root.drafts.subscribe,
  };

  return {
    writable: true,
    rootSource,
    rootController,
    phantoms,
    commitPhantomRow: root.drafts.commit,
  };
}
