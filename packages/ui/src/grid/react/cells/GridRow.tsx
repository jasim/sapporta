import { memo } from "react";
import type { GridPath, ColId, RowId } from "../../types/identity";
import type { ColumnSchema } from "../../types/schema";
import { useDisplayedRow } from "../GridRuntimeProvider";
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
  const row = useDisplayedRow(path, rowId);

  return (
    <div
      data-grid-part="row"
      data-row-id={row.id}
      data-row-kind={row.kind}
      role="row"
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
