// Visible-order — the lazy view over runtime + coordinator state that
// names "what comes next under the cursor."
//
// Render and navigation must agree on order. Render reads
// `displayed.rows` + `coordinator.expansion` + `runtime.materializedChildren`
// to interleave the DOM (see GridLevel.tsx). Navigation reads exactly
// the same inputs through this module. There is no cached projection,
// no `VisibleTree`, no store — every call walks the live state.
//
// The module exposes two orthogonal motion primitives. Row motion
// crosses levels; column motion stays within a path. Compound keystrokes
// (Tab overflow, Page, Home/End) compose them at the dispatch layer.
// Each primitive has one reason to change.
//
// `resolveVisibleRowNavigation` is the only primitive that can land on a
// different schema, so it owns column-on-landing through `colPolicy`. The
// dispatch layer never overrides the result — the rule lives in one place,
// picked by the caller.

import type { ColumnSchema, LevelSchema } from "../types/schema";
import type { ColId, GridPath, RowId } from "../types/identity";
import { makeRowId, rootPath, rowKeyOfRowId } from "../types/identity";
import type { LevelRow, LevelRowKind } from "../types/level-row";
import type { RowCapabilities } from "../types/capabilities";
import type { ColPolicy, RowDirection } from "../types/action";
import type { GridRuntime } from "../runtime/create-grid-runtime";
import type { GridCoordinatorPublic } from "./coordinator";

export type { ColPolicy, RowDirection } from "../types/action";

export type VisibleCursor = {
  path: GridPath;
  rowId: RowId;
  colId: ColId;
};

export type VisibleRowPosition = {
  path: GridPath;
  rowId: RowId;
};

export type ColDirection = "left" | "right" | "start" | "end";
export type NavigationOverflow = "previous" | "next";

export type CellRowNavigationResult = {
  target: VisibleCursor | null;
  overflow: NavigationOverflow | null;
};

export type RowNavigationResult = {
  target: VisibleRowPosition | null;
  overflow: NavigationOverflow | null;
};

type CapabilitiesFn = (kind: LevelRowKind) => RowCapabilities;

// One step of the visible sequence: a focusable row at a path. Loading
// or errored child levels render but do not contribute steps; non-focusable
// rows (footer, etc.) likewise render but step through.
type RowStep = { path: GridPath; rowId: RowId };

// Lazy walk over the live tree. Yields every row in display order, then
// recurses into each expanded row's materialized children whose source
// is `ready`. Non-focusable rows are yielded too — the caller filters
// per its own rule (cursor motion skips them; index lookup needs them).
export function* visibleRows(
  runtime: GridRuntime,
  coordinator: GridCoordinatorPublic,
  path: GridPath,
): Generator<RowStep> {
  const expanded = coordinator.getState().expansion.get(path);
  for (const row of runtime.displayedRowsFor(path).rows) {
    yield { path, rowId: row.id };
    if (!expanded?.has(row.id)) continue;
    for (const cp of runtime.materializedChildren(path, row.id)) {
      if (runtime.snapshotFor(cp).status !== "ready") continue;
      yield* visibleRows(runtime, coordinator, cp);
    }
  }
}

function rootPathOf(runtime: GridRuntime): GridPath {
  return rootPath(runtime.schemaTopology.rootLevelName);
}

function getRow(runtime: GridRuntime, step: RowStep): LevelRow | undefined {
  return runtime.displayedRowsFor(step.path).rowById.get(step.rowId);
}

function isFocusable(
  runtime: GridRuntime,
  step: RowStep,
  capabilities: CapabilitiesFn,
): boolean {
  const row = getRow(runtime, step);
  if (!row) return false;
  return capabilities(row.kind).focusable;
}

function isRowSelectable(runtime: GridRuntime, step: RowStep): boolean {
  return getRow(runtime, step)?.rowSelectable === true;
}

// Materialize the visible sequence. The traversal is O(visible rows
// walked). For today's data sizes and keystroke cadence this is cheap;
// if a profile shows hot, the call site can swap in an iterator-based
// walk that short-circuits at the target. Persisting state would re-
// introduce the divergence this module exists to prevent.
function collect(
  runtime: GridRuntime,
  coordinator: GridCoordinatorPublic,
): RowStep[] {
  return Array.from(visibleRows(runtime, coordinator, rootPathOf(runtime)));
}

function indexOfStep(steps: RowStep[], path: GridPath, rowId: RowId): number {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].path === path && steps[i].rowId === rowId) return i;
  }
  return -1;
}

// Walk steps from `fromIndex` in `step` direction (+1 / -1) and return
// the first focusable row. `fromIndex` is exclusive. Returns null if
// the search exhausts without finding a focusable row.
function nextFocusableStep(
  steps: RowStep[],
  fromIndex: number,
  step: 1 | -1,
  runtime: GridRuntime,
  capabilities: CapabilitiesFn,
): RowStep | null {
  for (let i = fromIndex + step; i >= 0 && i < steps.length; i += step) {
    if (isFocusable(runtime, steps[i], capabilities)) return steps[i];
  }
  return null;
}

function firstFocusableStep(
  steps: RowStep[],
  runtime: GridRuntime,
  capabilities: CapabilitiesFn,
): RowStep | null {
  return nextFocusableStep(steps, -1, 1, runtime, capabilities);
}

function lastFocusableStep(
  steps: RowStep[],
  runtime: GridRuntime,
  capabilities: CapabilitiesFn,
): RowStep | null {
  return nextFocusableStep(steps, steps.length, -1, runtime, capabilities);
}

// The first column whose row capabilities allow focus on the target row.
// All schema columns are equally valid focus targets today (column-level
// focusability does not exist yet); the row's focusability has already
// been confirmed by the caller. Keeping this as a named seam means a
// future "non-focusable column" feature lands in one place.
function firstColumn(schema: LevelSchema): ColId | null {
  const cols = schema.columns;
  return cols.length > 0 ? cols[0].id : null;
}

function lastColumn(schema: LevelSchema): ColId | null {
  const cols = schema.columns;
  return cols.length > 0 ? cols[cols.length - 1].id : null;
}

function hasColumn(schema: LevelSchema, colId: ColId): boolean {
  for (const c of schema.columns) {
    if (c.id === colId) return true;
  }
  return false;
}

function resolveColumn(
  targetSchema: LevelSchema,
  sourceColId: ColId,
  policy: ColPolicy,
): ColId | null {
  if (policy === "first") return firstColumn(targetSchema);
  if (policy === "last") return lastColumn(targetSchema);
  return hasColumn(targetSchema, sourceColId)
    ? sourceColId
    : firstColumn(targetSchema);
}

function makeCursor(
  step: RowStep,
  runtime: GridRuntime,
  sourceColId: ColId,
  policy: ColPolicy,
): VisibleCursor | null {
  const targetSchema = runtime.schemaAt(step.path);
  const colId = resolveColumn(targetSchema, sourceColId, policy);
  if (colId === null) return null;
  return { path: step.path, rowId: step.rowId, colId };
}

// `delta` jump that snaps onto a focusable row. We aim at
// `(currentIndex + delta)` clamped to range, then step toward the
// requested side from there; if that exhausts, step the other way.
// Mirrors the page-hop helper that lived in `key-handling.ts`, but
// across the cross-level visible sequence.
function deltaHop(
  steps: RowStep[],
  fromIndex: number,
  delta: number,
  runtime: GridRuntime,
  capabilities: CapabilitiesFn,
): RowStep | null {
  if (steps.length === 0) return null;
  const target = Math.max(0, Math.min(steps.length - 1, fromIndex + delta));
  const step: 1 | -1 = delta >= 0 ? 1 : -1;
  const back: 1 | -1 = step === 1 ? -1 : 1;
  return (
    nextFocusableStep(steps, target - step, step, runtime, capabilities) ??
    nextFocusableStep(steps, target - back, back, runtime, capabilities)
  );
}

function firstReachableIndex(
  steps: RowStep[],
  isReachable: (step: RowStep) => boolean,
): number {
  return steps.findIndex(isReachable);
}

function lastReachableIndex(
  steps: RowStep[],
  isReachable: (step: RowStep) => boolean,
): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (isReachable(steps[index])) return index;
  }
  return -1;
}

function deltaOverflow(
  steps: RowStep[],
  fromIndex: number,
  delta: number,
  isReachable: (step: RowStep) => boolean,
): NavigationOverflow | null {
  if (delta === 0) return null;
  const first = firstReachableIndex(steps, isReachable);
  const last = lastReachableIndex(steps, isReachable);
  if (first < 0 || last < 0) return delta < 0 ? "previous" : "next";
  if (delta < 0 && fromIndex <= first) return "previous";
  if (delta > 0 && fromIndex >= last) return "next";
  return null;
}

export type NextVisibleRowDeps = {
  capabilitiesFor: CapabilitiesFn;
};

// Cross-level row motion. The runtime and coordinator are read directly
// (no synthetic context object) — every input the walk needs already lives
// on those two surfaces. `colPolicy` chooses the column on landing; the
// dispatch layer never second-guesses the result.
export function resolveVisibleRowNavigation(
  runtime: GridRuntime,
  coordinator: GridCoordinatorPublic,
  from: VisibleCursor,
  dir: RowDirection,
  colPolicy: ColPolicy,
  deps: NextVisibleRowDeps,
): CellRowNavigationResult {
  const { capabilitiesFor } = deps;
  const steps = collect(runtime, coordinator);
  const idx = indexOfStep(steps, from.path, from.rowId);

  let target: RowStep | null;
  let overflow: NavigationOverflow | null = null;
  if (dir === "first") {
    target = firstFocusableStep(steps, runtime, capabilitiesFor);
  } else if (dir === "last") {
    target = lastFocusableStep(steps, runtime, capabilitiesFor);
  } else if (dir === "up") {
    if (idx < 0) return { target: null, overflow: null };
    target = nextFocusableStep(steps, idx, -1, runtime, capabilitiesFor);
    if (!target) overflow = "previous";
  } else if (dir === "down") {
    if (idx < 0) return { target: null, overflow: null };
    target = nextFocusableStep(steps, idx, 1, runtime, capabilitiesFor);
    if (!target) overflow = "next";
  } else {
    if (idx < 0) return { target: null, overflow: null };
    overflow = deltaOverflow(steps, idx, dir.delta, (step) =>
      isFocusable(runtime, step, capabilitiesFor),
    );
    if (overflow) return { target: null, overflow };
    target = deltaHop(steps, idx, dir.delta, runtime, capabilitiesFor);
  }

  if (!target) return { target: null, overflow };
  if (target.path === from.path && target.rowId === from.rowId) {
    return { target: null, overflow: null };
  }
  return {
    target: makeCursor(target, runtime, from.colId, colPolicy),
    overflow: null,
  };
}

export function resolveRowSelectableNavigation(
  runtime: GridRuntime,
  coordinator: GridCoordinatorPublic,
  from: VisibleRowPosition,
  direction: "up" | "down" | "first" | "last" | { delta: number },
): RowNavigationResult {
  const steps = collect(runtime, coordinator);
  const idx = indexOfStep(steps, from.path, from.rowId);
  let target: RowStep | null;
  let overflow: NavigationOverflow | null = null;
  if (direction === "first") {
    target = nextRowSelectableStep(steps, -1, 1, runtime);
  } else if (direction === "last") {
    target = nextRowSelectableStep(steps, steps.length, -1, runtime);
  } else if (direction === "up") {
    if (idx < 0) return { target: null, overflow: null };
    target = nextRowSelectableStep(steps, idx, -1, runtime);
    if (!target) overflow = "previous";
  } else if (direction === "down") {
    if (idx < 0) return { target: null, overflow: null };
    target = nextRowSelectableStep(steps, idx, 1, runtime);
    if (!target) overflow = "next";
  } else {
    if (idx < 0) return { target: null, overflow: null };
    overflow = deltaOverflow(steps, idx, direction.delta, (step) =>
      isRowSelectable(runtime, step),
    );
    if (overflow) return { target: null, overflow };
    target = rowDeltaHop(steps, idx, direction.delta, runtime);
  }
  if (!target) return { target: null, overflow };
  if (target.path === from.path && target.rowId === from.rowId) {
    return { target: null, overflow: null };
  }
  return { target, overflow: null };
}

function nextRowSelectableStep(
  steps: RowStep[],
  fromIndex: number,
  step: 1 | -1,
  runtime: GridRuntime,
): RowStep | null {
  for (let i = fromIndex + step; i >= 0 && i < steps.length; i += step) {
    if (isRowSelectable(runtime, steps[i])) return steps[i];
  }
  return null;
}

function rowDeltaHop(
  steps: RowStep[],
  fromIndex: number,
  delta: number,
  runtime: GridRuntime,
): RowStep | null {
  if (steps.length === 0) return null;
  const target = Math.max(0, Math.min(steps.length - 1, fromIndex + delta));
  const step: 1 | -1 = delta >= 0 ? 1 : -1;
  const back: 1 | -1 = step === 1 ? -1 : 1;
  return (
    nextRowSelectableStep(steps, target - step, step, runtime) ??
    nextRowSelectableStep(steps, target - back, back, runtime)
  );
}

// Path-local column motion. Returns the next ColId in the level's
// schema or null on overflow. Tab dispatch uses null to fall through
// to a row move.
export function nextColumn(
  schema: LevelSchema,
  fromColId: ColId,
  dir: ColDirection,
): ColId | null {
  const cols: readonly ColumnSchema[] = schema.columns;
  if (cols.length === 0) return null;
  const idx = cols.findIndex((c) => c.id === fromColId);
  switch (dir) {
    case "left":
      return idx > 0 ? cols[idx - 1].id : null;
    case "right":
      return idx >= 0 && idx < cols.length - 1 ? cols[idx + 1].id : null;
    case "start":
      return cols[0].id;
    case "end":
      return cols[cols.length - 1].id;
  }
}

// Convenience: derive a `RowId` from a path + rowKey, matching the
// `RowId = ${GridPath}#${RowKey}` invariant. Re-exported so callers
// composing visible-order calls don't need to reach into `identity.ts`.
export { makeRowId, rowKeyOfRowId };
