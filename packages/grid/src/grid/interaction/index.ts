export {
  createGridController,
  type GridControllerPublic,
  type GridControllerCursorPort,
  type GridControllerStore,
  type CreateControllerArgs,
} from "./controller";

export {
  createGridCoordinator,
  type GridCoordinatorPublic,
  type GridCoordinatorStore,
  type CoordinatorState,
  type CreateCoordinatorArgs,
  activePathOf,
} from "./coordinator";

export {
  createCursorManager,
  type CursorManager,
  type CursorManagerDeps,
} from "./cursor-manager";

export {
  keyEventToCellIntent,
  keyEventToRowIntent,
  rowSelectionGestureFromModifiers,
} from "./key-handling";
export {
  normalizeInteraction,
  assertValidInteraction,
} from "./normalize-interaction";
