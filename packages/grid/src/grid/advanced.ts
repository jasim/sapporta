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
import type {
  PhantomRowLifecycle,
  PhantomRowLifecycleDeps,
} from "./runtime/phantom-row-lifecycle";
import {
  runtimeInternalsFor,
  type GridRuntime,
} from "./runtime/create-grid-runtime";
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
      return raw.subscribe(
        internals.observe((state, previous) => {
          if (isCurrentLevel()) listener(state, previous);
        }),
      );
    },
    startEdit,
    activateCell(coord: Coord, trigger: CellActivationTrigger) {
      assertLevel();
      raw.activateCell(coord, trigger);
    },
    handleCellPointer(coord: Coord, gesture: "click" | "doubleClick") {
      assertLevel();
      return raw.handleCellPointer(coord, gesture);
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
        return raw.effects.subscribe(
          internals.observe((state, previous) => {
            if (isCurrentLevel()) listener(state, previous);
          }),
        );
      },
    }),
  });
  byPath.set(path, { level, controller: wrapper });
  return wrapper;
}

export function cellActivationFor(
  runtime: GridRuntime,
  path: GridPath,
  coord: Coord,
  trigger?: CellActivationTrigger,
): CellRenderActivation | null {
  runtime.level(path);
  return runtimeInternalsFor(runtime).cellActivationFor(path, coord, trigger);
}

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

export function planCursorContinuationForRowRemoval(
  runtime: GridRuntime,
  removals: readonly RowRemovalRef[],
): CursorContinuation {
  runtime.registeredLevels();
  return runtimeInternalsFor(runtime).planCursorContinuationForRowRemoval(
    removals,
  );
}

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
