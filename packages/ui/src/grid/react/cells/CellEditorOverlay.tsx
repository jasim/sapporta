import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { ColumnSchema } from "../../types/schema";
import type { ControllerState } from "../../types/controller-state";
import type { GridPath } from "../../types/identity";
import { useGridRuntime } from "../GridRuntimeProvider";

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
  schema: ColumnSchema[];
}) {
  const runtime = useGridRuntime();
  const controller = runtime.controllerFor(path);
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
    const cellSelector = `[data-row-id="${cssEscape(editing.coord.rowId)}"] [data-col-id="${cssEscape(editing.coord.colId)}"]`;
    let observedCell: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    function recompute() {
      const cell = container.querySelector<HTMLElement>(cellSelector);
      if (!cell) return;
      if (ro && observedCell !== cell) {
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
  const Editor = column.editCell;
  if (!Editor) return null;
  const row = runtime.displayedRowsFor(path).rowById.get(editing.coord.rowId);
  if (!row) return null;
  const value = row.columns[column.id];
  const editStart =
    editing.trigger === "type"
      ? { trigger: editing.trigger, typedSeed: editing.typedSeed }
      : { trigger: editing.trigger };

  return (
    <div
      className="grid-editor-overlay"
      style={{
        position: "absolute",
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
        zIndex: 10,
      }}
    >
      <Editor
        {...editStart}
        value={value}
        row={row}
        column={column}
        path={path}
        anchor={containerRef.current as HTMLElement}
        onCommit={(v, commit) => controller.commitEdit(v, commit)}
        onCancel={() => controller.cancelEdit()}
      />
    </div>
  );
}

function cssEscape(s: string): string {
  // Minimal escaping for our identifier shapes (paths and ids contain ".").
  if (
    typeof window !== "undefined" &&
    (window as Window & { CSS?: { escape?: (s: string) => string } }).CSS
      ?.escape
  ) {
    return (
      window as Window & { CSS: { escape: (s: string) => string } }
    ).CSS.escape(s);
  }
  return s.replace(/[^\w-]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}
