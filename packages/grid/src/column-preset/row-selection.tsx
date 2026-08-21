import type { ColId } from "../core/types/identity";
import type { ColumnSchema } from "../core/types/schema";
import type { ColumnWidth } from "./types";
import { column } from "./columns";
import { Checkbox } from "@sapporta/ui";
import { useGridRuntime } from "../core/react/GridRuntimeProvider";
import { useCurrentRowInteractionStatus } from "../core/react/cells/GridRow";
import styles from "./sapporta-preset.module.css";

// Row-selection chrome belongs to ColumnPreset, not the base grid.
//
// The headless runtime knows how to store, normalize, derive, and subscribe to
// selected rows. It does not decide that selection should look like a checkbox,
// where that checkbox column sits, how wide it is, or how the selected row is
// styled. This helper returns an ordinary ColumnSchema so table/admin surfaces
// can opt into checkbox selection by prepending a column, while custom grid
// consumers can choose different chrome over the same runtime commands.
export type RowSelectionColumnOptions = {
  id?: ColId;
  name?: string;
  width?: ColumnWidth;
  header?: "checkbox" | "blank";
};

export function rowSelectionColumn(
  options?: RowSelectionColumnOptions,
): ColumnSchema {
  return column({
    kind: "rowSelection",
    id: options?.id ?? "__row_selection",
    name: options?.name ?? "",
    width: options?.width ?? "compact",
    edit: "none",
    sortable: false,
    renderCell: (props) => <RowSelectionCell {...props} />,
  });
}

function RowSelectionCell({
  row,
  path,
}: Parameters<ColumnSchema["renderCell"]>[0]) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const rowInteractionStatus = useCurrentRowInteractionStatus();
  const checked =
    rowInteractionStatus === "selected" ||
    rowInteractionStatus === "cursor-selected";
  const disabled = !row.rowSelectable;

  function onCheckedChange(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    // Checkbox gestures mutate operation targets only. They intentionally do
    // not move the cell cursor, row cursor, or live focus; keyboard routing
    // remains whatever `runtime.interaction.mode` said at construction time.
    if (event instanceof MouseEvent && event.shiftKey) {
      level.extendRowSelectionTo(row.id);
    } else {
      level.toggleRowSelection(row.id);
    }
  }

  return (
    <div className={styles.rowSelectionCell}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(_, eventDetails) =>
          onCheckedChange(eventDetails.event)
        }
      />
    </div>
  );
}
