import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ColumnSchema, RowHeaderColumn } from "../types/schema";
import { decomposePath, type GridPath } from "../types/identity";
import type { GridControllerPublic } from "../interaction/controller";
import { GridHeader } from "./GridHeader";
import { CellEditorOverlay } from "./cells/CellEditorOverlay";
import { EffectRunner } from "./EffectRunner";
import { useGridRuntime } from "./GridRuntimeProvider";
import {
  eventBelongsToGridRoot,
  gridRootIdentityAttrs,
} from "./internal/dom-targets";
import styles from "./grid.module.css";
import { cn } from "@sapporta/ui";
import { runtimeInternalsFor } from "../runtime/create-grid-runtime";

export type GridChromeContext = {
  path: GridPath;
  levelName: string;
  presentation: GridPresentation;
  schema: readonly ColumnSchema[];
  rowHeaderColumn: RowHeaderColumn;
};

export type GridPresentation = "tabular" | "cards";

// Paint-only chrome wrapper. Body composition belongs to GridLevel — Grid
// renders whatever `children` it is handed inside its container so the
// caller can interleave child levels under the rows that own them.
//
// Four things and nothing else:
//   1. Attach a native keydown listener bound to controller.handleKey,
//      guarded so only the innermost grid containing the event target
//      acts. Bubbling still wakes ancestor grids; the guard ensures only
//      the right one consumes the key.
//   2. Render <GridHeader>.
//   3. Render `children` (rows + interleaved child level mounts).
//   4. Render <CellEditorOverlay> for this path (singleton overlay).
//
// Grid also decorates its container with `data-grid-path` and
// `data-active` (from `coordinator.cellCursor?.path === path`). The
// active/ghost distinction is level-scoped state that preset or app CSS can
// style through the root attribute, not via per-cell subscriptions.
//
// Grid also mounts EffectRunner (drains the controller's effects channel)
// and the overlay portal slot (`data-grid-overlay`) that editors portal
// dropdowns/calendars into. Cursor movement queues focus effects through
// the cursor manager, so EffectRunner drains the target path's queue on the
// next paint — including when this Grid is mounting for the first time,
// since controllers outlive DOM presence and the queue persists across
// mounts.
//
// The single useEffect here is for DOM wiring only — it doesn't subscribe
// to data. The keydown listener is native (not React's synthetic) so it
// fires before React's event delegation and can preventDefault reliably.
export function Grid({
  path,
  schema,
  rowHeaderColumn,
  controller,
  renderHeader,
  levelContainerClassName,
  levelContainerStyle,
  presentation = "tabular",
  children,
}: {
  path: GridPath;
  schema: readonly ColumnSchema[];
  rowHeaderColumn: RowHeaderColumn;
  controller: GridControllerPublic;
  presentation?: GridPresentation;
  renderHeader?: (ctx: GridChromeContext) => ReactNode;
  levelContainerClassName?: (ctx: GridChromeContext) => string | undefined;
  levelContainerStyle?: (ctx: GridChromeContext) => CSSProperties | undefined;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtime = useGridRuntime();
  const internals = runtimeInternalsFor(runtime);
  const isActive = useStore(internals.coordinator, (s) =>
    runtime.interaction.mode === "cell-grid"
      ? s.cellCursor?.path === path
      : s.rowCursor?.path === path,
  );
  const chromeContext = {
    path,
    levelName: levelNameFromPath(path),
    presentation,
    schema,
    rowHeaderColumn,
  };
  const header = renderHeader?.(chromeContext);
  const className = levelContainerClassName?.(chromeContext);
  const style = levelContainerStyle?.(chromeContext);
  const depth = decomposePath(path).edges.length;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // Capture the element used for this effect. The same root receives the
    // native listener and later removes it during cleanup, even if React writes
    // a new ref value before the cleanup runs.
    const root = node;
    function onKeyDown(e: KeyboardEvent) {
      // With nested grids, every ancestor grid sees the bubbling event.
      // Only the innermost grid containing the event target should act —
      // otherwise a key inside a child grid would also move the parent.
      if (!eventBelongsToGridRoot(e.target, root)) return;
      // Structural row-header controls own Space and Escape themselves. They
      // deliberately have no cell coordinate for the grid key handler to use.
      if (
        e.target instanceof Element &&
        e.target.closest('[data-grid-part="row-header-control"]')
      ) {
        return;
      }
      // handleKey returns true iff it consumed the event — that's the only
      // signal we need to decide whether to suppress browser defaults.
      if (controller.handleKey(e, presentation)) {
        e.preventDefault();
      }
    }
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
    };
  }, [controller, presentation]);

  return (
    <div
      ref={containerRef}
      className={cn(styles.root, className)}
      tabIndex={0}
      role="grid"
      {...gridRootIdentityAttrs(path)}
      data-grid-presentation={presentation}
      data-grid-depth={depth}
      data-row-header-kind={rowHeaderKind(rowHeaderColumn)}
      data-active={String(isActive)}
      style={{ position: "relative", outline: "none", ...style }}
    >
      {header ??
        (presentation === "tabular" ? (
          <GridHeader schema={schema} rowHeaderColumn={rowHeaderColumn} />
        ) : null)}
      {children}
      <CellEditorOverlay
        containerRef={containerRef}
        path={path}
        schema={schema}
      />
      <EffectRunner controller={controller} containerRef={containerRef} />
      <div
        data-grid-overlay
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

function rowHeaderKind(
  rowHeaderColumn: RowHeaderColumn,
): "column" | "empty-selectable-cell" | undefined {
  if (typeof rowHeaderColumn === "object") return "column";
  return rowHeaderColumn === "empty-selectable-cell"
    ? rowHeaderColumn
    : undefined;
}

export function levelNameFromPath(path: GridPath): string {
  const decomp = decomposePath(path);
  return decomp.edges.length === 0
    ? decomp.rootLevelName
    : decomp.edges[decomp.edges.length - 1].levelName;
}
