import type { MouseEvent, ReactNode } from "react";
import type { CellSelectionStatus } from "../../types/selection";
import type { ColumnSchema } from "../../types/schema";
import { cellClasses } from "./cell-classes";

// Wraps cell content with focus/selection chrome.
//
// Renderers do not read status or active-ness — CellShell does. This is
// the boundary: the renderer's output is identical across focus flips,
// so React diff produces zero DOM mutations when focus moves. The only
// cost of a focus move to a cell is one JS function call (the selector
// flip) — no DOM reads or writes.
export function CellShell(props: {
  status: CellSelectionStatus;
  column: ColumnSchema;
  children: ReactNode;
  onMouseDown?: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
}) {
  return (
    <div
      className={cellClasses(props.status)}
      role="gridcell"
      data-cell-status={props.status}
      data-col-id={props.column.id}
      onMouseDown={props.onMouseDown}
      onDoubleClick={props.onDoubleClick}
    >
      <div className="grid-cell__content">{props.children}</div>
    </div>
  );
}
