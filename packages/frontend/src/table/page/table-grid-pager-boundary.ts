import type { RefObject } from "react";
import type { GridRuntime, SourceLoadResult } from "@sapporta/grid";
import { controllerFor, cursorManagerFor } from "@sapporta/grid/advanced";
import type { TGridLevelId, TGridRowsByLevel } from "../tgrid/tgrid-types";
import type { TGridLoadedRowsBoundaryHandler } from "../tgrid/tgrid-session";
import type { TablePagerDirection } from "./TablePagers";

export type TableGridPagerButtonRefs = {
  previous: RefObject<HTMLButtonElement | null>;
  next: RefObject<HTMLButtonElement | null>;
};

type PendingPagerBoundary = {
  direction: TablePagerDirection;
  continue: () => void;
  cancel: () => void;
};

export type TableGridPagerBoundaryController<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  onLoadedRowsBoundary: TGridLoadedRowsBoundaryHandler<
    RowsByLevel,
    AppServices
  >;
  onPagerButtonActivate: (direction: TablePagerDirection) => boolean;
  onPagerBoundaryExit: () => void;
};

// Standard table-page boundary policy. The grid reports the loaded-row edge;
// this controller pauses on the pager until the focused button is explicitly
// activated. The grid runtime remains the sole owner of post-load landing.
export function createTableGridPagerBoundaryController<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  rootLevel: TGridLevelId<RowsByLevel>,
  buttonRefs: TableGridPagerButtonRefs,
): TableGridPagerBoundaryController<RowsByLevel, AppServices> {
  let pending: PendingPagerBoundary | null = null;

  const onLoadedRowsBoundary: TGridLoadedRowsBoundaryHandler<
    RowsByLevel,
    AppServices
  > = (event, boundaryLevel, session) => {
    // The footer controls the root source. Declining a source-owned child edge
    // lets traversal offer the same intent to its root ancestor.
    if (boundaryLevel !== rootLevel) return false;
    if (!focusTableGridPagerBoundary(event.direction, buttonRefs)) return false;
    cancelPending();

    return new Promise<SourceLoadResult>((resolve) => {
      pending = {
        direction: event.direction,
        continue: () => {
          const query = session.getQueryState(rootLevel);
          const page =
            event.direction === "after" ? query.page + 1 : query.page - 1;
          resolve(
            session.setLevelPage(
              rootLevel,
              event.loadPath,
              page,
              query.pageSize,
            ),
          );
        },
        cancel: () => resolve({ kind: "superseded" }),
      };
    });
  };

  function cancelPending(): void {
    const boundary = pending;
    pending = null;
    boundary?.cancel();
  }

  return {
    onLoadedRowsBoundary,
    onPagerButtonActivate(direction) {
      if (pending?.direction !== direction) return false;
      const boundary = pending;
      pending = null;
      boundary.continue();
      return true;
    },
    onPagerBoundaryExit: cancelPending,
  };
}

export function focusTableGrid(runtime: GridRuntime): void {
  const cursors = cursorManagerFor(runtime);
  const activePath =
    runtime.interaction.mode === "cell-grid"
      ? cursors.currentCellCursor()?.path
      : cursors.currentRowCursor()?.path;
  controllerFor(runtime, activePath ?? runtime.root.path).focus();
}

export function focusTableGridPagerBoundary(
  direction: TablePagerDirection,
  buttonRefs: TableGridPagerButtonRefs,
): boolean {
  const button =
    direction === "after"
      ? buttonRefs.next.current
      : buttonRefs.previous.current;
  if (!button || button.disabled) return false;

  button.focus();
  return true;
}
