import { memo } from "react";
import type { GridPath, ColId, RowId } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import { capabilitiesFor } from "../../types/capabilities";
import {
  useDisplayedRow,
  useGridRuntime,
  useRowInteractionStatus,
} from "../GridRuntimeProvider";
import { GridDataCell } from "./GridDataCell";

// The only `React.memo` in the grid — structurally justified, not a
// hot-path hack.
//
// The parent passes stable identity props; the row data itself arrives through
// `useDisplayedRow`. Selection, focus, and editing flips inside the row hit
// GridDataCell's store subscriptions directly — they never bubble through
// GridRow. Without this memo, a parent's structural re-render would cascade to
// all rows regardless of whether their data changed.
export const GridRow = memo(function GridRow({
  rowId,
  schema,
  path,
  colOrder,
}: {
  rowId: RowId;
  schema: ColumnSchema[];
  path: GridPath;
  colOrder: readonly ColId[];
}) {
  const runtime = useGridRuntime();
  const row = useDisplayedRow(path, rowId);
  const rowInteractionStatus = useRowInteractionStatus(path, row.id);

  return (
    <div
      data-grid-part="row"
      data-row-id={row.id}
      data-row-kind={row.kind}
      data-row-interaction-status={rowInteractionStatus}
      data-row-selectable={String(capabilitiesFor(row.kind).rowSelectable)}
      role="row"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (runtime.interaction.mode !== "row-list") return;
        if (!row.rowSelectable) return;
        event.preventDefault();
        // In row-list mode, row click owns the row cursor. In cell-grid mode,
        // cell click owns the cell cursor instead, so this row shell stays out
        // of the cell interaction path.
        if (event.shiftKey) {
          runtime.cursorManager.extendRowSelectionToCursor({ path, rowId: row.id });
        } else {
          runtime.cursorManager.moveRowCursorTo({ path, rowId: row.id });
        }
      }}
    >
      {schema.map((col) => (
        <GridDataCell
          key={col.id}
          row={row}
          column={col}
          path={path}
          colOrder={colOrder}
        />
      ))}
    </div>
  );
});
