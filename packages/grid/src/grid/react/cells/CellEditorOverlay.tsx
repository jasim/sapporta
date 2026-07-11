import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ColumnSchema } from "../../types/schema";
import type { ControllerState } from "../../types/controller-state";
import type { GridPath } from "../../types/identity";
import { useGridRuntime } from "../GridRuntimeProvider";
import { findGridCellElement } from "../internal/dom-targets";
import { runtimeInternalsFor } from "../../runtime/create-grid-runtime";

// Singleton per path. When `editing` is non-null, find the focused cell DOM
// node, position absolutely on top, and render the column's editor. When null,
// render nothing.
//
// Why an overlay, not a branch inside the cell? Starting an edit doesn't
// re-render the focused cell. The cell's `status` flips from "focus" to
// "editing" for class purposes (one selector flip → one re-render for CSS),
// and the overlay mounts in parallel on top. The visual cell underneath
// continues to display its normal value; the overlay floats on top with
// the editor. This avoids the cost of unmounting/remounting a cell's
// render tree just to swap in an editor.
//
// The only `useState` in the grid: `position` measures DOM geometry so the
// overlay tracks its anchor cell. This is local to the overlay, not grid
// state — it doesn't violate the no-`useState`-over-data rule.
export function CellEditorOverlay({
  containerRef,
  path,
  schema,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  path: GridPath;
  schema: readonly ColumnSchema[];
}) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const controller = runtimeInternalsFor(runtime).controllerFor(path);
  const editing = useStore(controller, (s: ControllerState) => s.editing);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!editing || !containerRef.current) {
      setPosition(null);
      return;
    }
    const container = containerRef.current;
    // This effect follows one editing cell. When editing moves or closes,
    // React runs cleanup and starts a new effect, so scroll/resize callbacks use
    // the coordinate captured for this observer subscription.
    const coord = editing.coord;
    let observedCell: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    function recompute() {
      const cell = findGridCellElement(container, coord);
      if (!cell) return;
      if (ro && observedCell !== cell) {
        // The same logical cell can remount under the same row/column identity
        // after a structural change. Observe the live DOM node so editor chrome
        // tracks the current cell box.
        if (observedCell) ro.unobserve(observedCell);
        ro.observe(cell);
        observedCell = cell;
      }
      const cb = cell.getBoundingClientRect();
      const wrap = container.getBoundingClientRect();
      setPosition({
        left: cb.left - wrap.left + container.scrollLeft,
        top: cb.top - wrap.top + container.scrollTop,
        width: cb.width,
        height: cb.height,
      });
    }

    // Track scrolls inside the grid and viewport resizes so the overlay
    // tracks its anchor cell while editing.
    container.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(recompute)
        : null;
    // The first recompute positions the editor and starts observing the current
    // cell. Container observation catches track-size changes that move the cell
    // without changing the cell element itself.
    ro?.observe(container);
    recompute();
    return () => {
      container.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
      ro?.disconnect();
    };
  }, [editing, containerRef]);

  if (!editing || !position) return null;

  const column = schema.find((c) => c.id === editing.coord.colId);
  if (!column) return null;
  const Editor = column.edit?.editor;
  if (!Editor) return null;
  const row = level.displayedRow(editing.coord.rowId);
  if (!row) return null;
  const value = row.columns[column.id];

  return (
    <div
      data-grid-part="editor-overlay"
      style={{
        position: "absolute",
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
        zIndex: "var(--sap-z-grid-editor)",
      }}
    >
      <Editor
        editStart={editing.editStart}
        value={value}
        row={row}
        column={column}
        path={path}
        anchor={containerRef.current as HTMLElement}
        commit={(v, commit) => controller.commitEdit(v, commit)}
        cancel={() => controller.cancelEdit()}
      />
    </div>
  );
}
