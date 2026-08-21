import type { MouseEvent, ReactNode } from "react";
import type { CellSelectionStatus } from "../../types/selection";
import type { ColumnSchema } from "../../types/schema";
import { gridCellIdentityAttrs } from "../internal/dom-targets";

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
  rowHeader?: boolean;
  children: ReactNode;
  onMouseDown?: (e: MouseEvent) => void;
  onClick?: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
}) {
  return (
    <div
      role={props.rowHeader ? "rowheader" : "gridcell"}
      {...gridCellIdentityAttrs(props.column.id)}
      data-row-header-kind={props.rowHeader ? "column" : undefined}
      data-cell-status={props.status}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
    >
      <div data-grid-part="cell-content">{props.children}</div>
    </div>
  );
}
