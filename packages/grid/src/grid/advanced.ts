import { createPhantomChannel } from "./data-sources/phantom-channel";
import type { PhantomChannel } from "./data-sources/types";
import type {
  CursorContinuation,
  RowRemovalRef,
} from "./interaction/cursor-continuation";
import type { CursorManager } from "./interaction/cursor-manager";
import type { GridControllerPublic } from "./interaction/controller";
import type { CellKeyboardPresentation } from "./interaction/key-handling";
import { createPhantomRowLifecycle } from "./runtime/phantom-row-lifecycle";
import { trackGridLevelSubscription } from "./runtime/grid-level-runtime";
import type {
  PhantomRowLifecycle,
  PhantomRowLifecycleDeps,
} from "./runtime/phantom-row-lifecycle";
import { runtimeInternalsFor, type GridRuntime } from "./runtime/runtime";
import type { CellCursor, Coord, GridPath, RowId } from "./types/identity";
import type { RowCursor, RowSelection } from "./types/row-selection";
import type {
  CellActivationTrigger,
  CellRenderActivation,
  NonTypedCellEditGesture,
} from "./types/schema";
import type { CellSelectionState } from "./types/selection";
import type { PhantomRow } from "./types/level-row";
import type { CommitTarget } from "./types/action";
import type { ControllerState } from "./types/controller-state";
import type { GridEffect } from "./types/effects";
import type { GridPointerInput } from "./types/interaction";

const cursorWrappers = new WeakMap<GridRuntime, CursorManager>();
const controllerWrappers = new WeakMap<
  GridRuntime,
  Map<
    GridPath,
    {
      readonly level: ReturnType<GridRuntime["level"]>;
      readonly controller: GridControllerPublic;
    }
  >
>();

/**
 * Returns advanced cursor commands for a runtime.
 *
 * The wrapper checks the runtime or target level before every command. It does
 * not let an old cursor manager keep operating after disposal or after a path
 * registration ends.
 */
export function cursorManagerFor(runtime: GridRuntime): CursorManager {
  runtime.registeredLevels();
  const existing = cursorWrappers.get(runtime);
  if (existing) return existing;
  const raw = runtimeInternalsFor(runtime).cursorManager;
  const assertRuntime = () => {
    runtime.registeredLevels();
  };
  const assertPath = (path: GridPath) => {
    runtime.level(path);
  };
  const wrapper: CursorManager = Object.freeze({
    moveCellCursorTo(target: CellCursor) {
      assertPath(target.path);
      raw.moveCellCursorTo(target);
    },
    extendCellSelectionTo(target: CellCursor) {
      assertPath(target.path);
      raw.extendCellSelectionTo(target);
    },
    setCellRange(path: GridPath, anchor: Coord, head: Coord) {
      assertPath(path);
      raw.setCellRange(path, anchor, head);
    },
    clearCellRange(path: GridPath) {
      assertPath(path);
      raw.clearCellRange(path);
    },
    clearCellCursor() {
      assertRuntime();
      raw.clearCellCursor();
    },
    currentCellCursor() {
      assertRuntime();
      return raw.currentCellCursor();
    },
    moveRowCursorTo(target: RowCursor) {
      assertPath(target.path);
      raw.moveRowCursorTo(target);
    },
    extendRowSelectionToCursor(target: RowCursor) {
      assertPath(target.path);
      raw.extendRowSelectionToCursor(target);
    },
    setRowSelection(path: GridPath, selection: RowSelection) {
      assertPath(path);
      raw.setRowSelection(path, selection);
    },
    clearRowSelection(path: GridPath) {
      assertPath(path);
      raw.clearRowSelection(path);
    },
    clearRowCursor() {
      assertRuntime();
      raw.clearRowCursor();
    },
    currentRowCursor() {
      assertRuntime();
      return raw.currentRowCursor();
    },
  });
  cursorWrappers.set(runtime, wrapper);
  return wrapper;
}

/**
 * Returns the path-local controller for one current level registration.
 *
 * Use this surface for editing, raw controller state, keyboard dispatch, and
 * queued effects. Its state and effects subscriptions are different: state
 * describes interaction, while effects describe imperative work waiting for a
 * mounted renderer. Both subscriptions stop when the level unregisters.
 */
export function controllerFor(
  runtime: GridRuntime,
  path: GridPath,
): GridControllerPublic {
  const level = runtime.level(path);
  let byPath = controllerWrappers.get(runtime);
  if (!byPath) {
    byPath = new Map();
    controllerWrappers.set(runtime, byPath);
  }
  const existing = byPath.get(path);
  if (existing?.level === level) return existing.controller;
  const internals = runtimeInternalsFor(runtime);
  const raw = internals.controllerFor(path);
  const assertLevel = () => {
    if (runtime.level(path) !== level) {
      throw new Error("Grid level is no longer registered.");
    }
  };
  const isCurrentLevel = () => runtime.registeredLevels().includes(level);

  function startEdit(coord: Coord, trigger: "type", initial: string): void;
  function startEdit(coord: Coord, trigger: NonTypedCellEditGesture): void;
  function startEdit(
    coord: Coord,
    trigger: "type" | NonTypedCellEditGesture,
    initial?: string,
  ): void {
    assertLevel();
    if (trigger === "type") raw.startEdit(coord, trigger, initial ?? "");
    else raw.startEdit(coord, trigger);
  }

  const wrapper: GridControllerPublic = Object.freeze({
    getState() {
      assertLevel();
      return raw.getState();
    },
    getInitialState() {
      assertLevel();
      return raw.getInitialState();
    },
    subscribe(
      listener: (state: ControllerState, previous: ControllerState) => void,
    ) {
      assertLevel();
      return trackGridLevelSubscription(
        level,
        raw.subscribe(
          internals.observe((state, previous) => {
            if (isCurrentLevel()) listener(state, previous);
          }),
        ),
      );
    },
    startEdit,
    activateCell(coord: Coord, trigger: CellActivationTrigger) {
      assertLevel();
      raw.activateCell(coord, trigger);
    },
    handleCellPointer(coord: Coord, pointer: GridPointerInput) {
      assertLevel();
      return raw.handleCellPointer(coord, pointer);
    },
    handleRowPointer(rowId: RowId, pointer: GridPointerInput) {
      assertLevel();
      return raw.handleRowPointer(rowId, pointer);
    },
    cancelEdit() {
      assertLevel();
      raw.cancelEdit();
    },
    commitEdit(value: unknown, commit?: CommitTarget) {
      assertLevel();
      raw.commitEdit(value, commit);
    },
    clearCellSelection() {
      assertLevel();
      raw.clearCellSelection();
    },
    clearRowSelection() {
      assertLevel();
      raw.clearRowSelection();
    },
    focus() {
      assertLevel();
      raw.focus();
    },
    handleKey(event: KeyboardEvent, presentation?: CellKeyboardPresentation) {
      assertLevel();
      return raw.handleKey(event, presentation);
    },
    revealCell(coord: Coord) {
      assertLevel();
      raw.revealCell(coord);
    },
    revealRow(rowId: RowId) {
      assertLevel();
      raw.revealRow(rowId);
    },
    flushEffects() {
      assertLevel();
      raw.flushEffects();
    },
    effects: Object.freeze({
      getState() {
        assertLevel();
        return raw.effects.getState();
      },
      getInitialState() {
        assertLevel();
        return raw.effects.getInitialState();
      },
      subscribe(
        listener: (
          state: readonly GridEffect[],
          previous: readonly GridEffect[],
        ) => void,
      ) {
        assertLevel();
        return trackGridLevelSubscription(
          level,
          raw.effects.subscribe(
            internals.observe((state, previous) => {
              if (isCurrentLevel()) listener(state, previous);
            }),
          ),
        );
      },
    }),
  });
  byPath.set(path, { level, controller: wrapper });
  return wrapper;
}

/**
 * Describes and runs the configured activation for one displayed cell.
 * Returns `null` when the column or row does not provide an activation.
 */
export function cellActivationFor(
  runtime: GridRuntime,
  path: GridPath,
  coord: Coord,
  trigger?: CellActivationTrigger,
): CellRenderActivation | null {
  runtime.level(path);
  return runtimeInternalsFor(runtime).cellActivationFor(path, coord, trigger);
}

/**
 * Returns registered child paths for one parent row in schema declaration
 * order. The result includes collapsed children because collapse retains their
 * registrations.
 */
export function materializedChildren(
  runtime: GridRuntime,
  parentPath: GridPath,
  rowId: RowId,
): readonly GridPath[] {
  runtime.level(parentPath);
  return Object.freeze([
    ...runtimeInternalsFor(runtime).materializedChildren(parentPath, rowId),
  ]);
}

/**
 * Chooses a valid focus landing from the current visible tree before the
 * listed rows are removed.
 */
export function planCursorContinuationForRowRemoval(
  runtime: GridRuntime,
  removals: readonly RowRemovalRef[],
): CursorContinuation {
  runtime.registeredLevels();
  return runtimeInternalsFor(runtime).planCursorContinuationForRowRemoval(
    removals,
  );
}

/** Applies a previously computed cursor landing and queues reveal work. */
export function applyCursorContinuation(
  runtime: GridRuntime,
  continuation: CursorContinuation,
): void {
  runtime.registeredLevels();
  runtimeInternalsFor(runtime).applyCursorContinuation(continuation);
}

export { createPhantomChannel, createPhantomRowLifecycle };
export type {
  CellSelectionState,
  CursorContinuation,
  CursorManager,
  GridControllerPublic,
  PhantomChannel,
  PhantomRow,
  PhantomRowLifecycle,
  PhantomRowLifecycleDeps,
  RowRemovalRef,
};
