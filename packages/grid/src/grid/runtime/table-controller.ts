// Convenience layer for the flat-table host case. Wraps a runtime's
// root path so callers don't thread `rootPath(rootLevelName)` through
// every call. Holds no state of its own — every method delegates to
// the runtime's source, controller, phantom channel, or commit helper.
//
// For nested grids, callers go through `runtime.controllerFor(path)` /
// `runtime.sourceFor(path)` / `runtime.phantoms` / `runtime.commitPhantomRow`
// directly. This wrapper exists for the dominant case where the host
// only cares about the root level. It does NOT replace
// `runtime.controllerFor(...)` for nested grids — those still go through
// the runtime.
//
// The wrapper is a discriminated union on the root source's `writable`
// flag. `rootSource` is always the runtime's read view and never exposes
// edit verbs; writable roots add phantom helpers and commitPhantomRow.
// Runtime methods remain the write seam. At runtime,
// `'setCell' in controller.rootSource === false`.

import type { ColId, GridPath, RowKey } from "../types/identity";
import type { PhantomRow } from "../types/level-row";
import type { GridRuntime } from "./create-grid-runtime";
import type { GridControllerPublic } from "../interaction/controller";
import type { RuntimeLevelDataSource } from "../data-sources/types";

// PhantomChannel verbs with the path argument bound to the root.
export type RootPhantomHelpers = {
  get: () => PhantomRow[];
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
  // Two-step commit delegated to `runtime.commitPhantomRow` for the root
  // path. Atomic from the host's view; emits `phantomRowCommitted` on
  // success.
  commitPhantomRow: (rowKey: RowKey, atIndex?: number) => Promise<unknown>;
};

export type TableController = ReadonlyTableController | WritableTableController;

export function createTableController(args: {
  runtime: GridRuntime;
}): TableController {
  const { runtime } = args;
  const path = runtime.schemaTopology.rootLevelName as GridPath;
  const rootSource = runtime.sourceFor(path);
  const rootController = runtime.controllerFor(path);

  if (!rootSource.writable) {
    return { writable: false, rootSource, rootController };
  }

  const phantoms: RootPhantomHelpers = {
    get: () => runtime.phantoms.get(path),
    add: (phantom) => runtime.phantoms.add(path, phantom),
    remove: (rowKey) => runtime.phantoms.remove(path, rowKey),
    setCell: (rowKey, colId, value) =>
      runtime.phantoms.setCell(path, rowKey, colId, value),
    subscribe: (fn) => runtime.phantoms.subscribe(path, fn),
  };

  return {
    writable: true,
    rootSource,
    rootController,
    phantoms,
    commitPhantomRow: (rowKey, atIndex) =>
      runtime.commitPhantomRow(path, rowKey, atIndex),
  };
}
