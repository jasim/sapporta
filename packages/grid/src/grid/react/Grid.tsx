import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import type { ColumnSchema } from "../types/schema";
import { decomposePath, type GridPath } from "../types/identity";
import type { GridControllerPublic } from "../interaction/controller";
import { GridHeader } from "./GridHeader";
import { CellEditorOverlay } from "./cells/CellEditorOverlay";
import { EffectRunner } from "./EffectRunner";
import { useGridRuntime } from "./GridRuntimeProvider";
import styles from "./grid.module.css";
import { cn } from "@sapporta/ui";

export type GridChromeContext = {
  path: GridPath;
  levelName: string;
  schema: ColumnSchema[];
};

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
  controller,
  renderLevelHeader,
  levelContainerClassName,
  levelContainerStyle,
  children,
}: {
  path: GridPath;
  schema: ColumnSchema[];
  controller: GridControllerPublic;
  renderLevelHeader?: (ctx: GridChromeContext) => ReactNode;
  levelContainerClassName?: (ctx: GridChromeContext) => string | undefined;
  levelContainerStyle?: (ctx: GridChromeContext) => CSSProperties | undefined;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtime = useGridRuntime();
  const isActive = useStore(runtime.coordinator, (s) =>
    runtime.interaction.mode === "cell-grid"
      ? s.cellCursor?.path === path
      : s.rowCursor?.path === path,
  );
  const chromeContext = { path, levelName: levelNameFromPath(path), schema };
  const header = renderLevelHeader?.(chromeContext);
  const className = levelContainerClassName?.(chromeContext);
  const style = levelContainerStyle?.(chromeContext);
  const depth = decomposePath(path).edges.length;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onKeyDown(e: KeyboardEvent) {
      // With nested grids, every ancestor grid sees the bubbling event.
      // Only the innermost grid containing the event target should act —
      // otherwise a key inside a child grid would also move the parent.
      const target = e.target as Element | null;
      const closest = target?.closest("[data-grid-path]");
      if (closest !== node) return;
      // handleKey returns true iff it consumed the event — that's the only
      // signal we need to decide whether to suppress browser defaults.
      if (controller.handleKey(e)) e.preventDefault();
    }
    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
    };
  }, [controller]);

  return (
    <div
      ref={containerRef}
      className={cn(styles.root, className)}
      tabIndex={0}
      role="grid"
      data-grid-part="root"
      data-grid-path={path}
      data-grid-depth={depth}
      data-active={String(isActive)}
      style={{ position: "relative", outline: "none", ...style }}
    >
      {header ?? <GridHeader schema={schema} />}
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

export function levelNameFromPath(path: GridPath): string {
  const decomp = decomposePath(path);
  return decomp.edges.length === 0
    ? decomp.rootLevelName
    : decomp.edges[decomp.edges.length - 1].levelName;
}
