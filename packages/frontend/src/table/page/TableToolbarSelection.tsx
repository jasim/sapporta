import { Trash2, X } from "lucide-react";
import {
  clearTableToolbarSelection,
  type TableToolbarSelectionState,
} from "./TableToolbarDeleteRowAction";
import type { TableToolbarProps } from "./TableToolbar";
import {
  CompactToolbarButton,
  formatRecordCount,
} from "./TableToolbarControls";

export function TableToolbarSelection({
  session,
  tableLabel,
  totalCount,
  selection,
}: TableToolbarProps & { selection: TableToolbarSelectionState }) {
  return (
    <div className="sticky top-0 z-[var(--sap-z-shell-sticky)] border-b border-sap-border-soft bg-sap-surface/95 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-[720] leading-5 text-sap-fg">
            {selection.count} selected
          </h1>
          <p className="mono mt-[1px] truncate text-[11.5px] text-sap-muted">
            {tableLabel} · {formatRecordCount(totalCount)}
          </p>
        </div>
        <CompactToolbarButton
          tone="danger"
          icon={<Trash2 className="h-4 w-4 shrink-0" />}
          disabled={selection.kind === "none"}
        >
          Delete
        </CompactToolbarButton>
        <CompactToolbarButton
          aria-label="Clear row selection"
          title="Clear selection"
          icon={<X className="h-4 w-4" />}
          onClick={() => clearTableToolbarSelection(session)}
          className="shrink-0 px-0"
        >
          <span className="sr-only">Clear selection</span>
        </CompactToolbarButton>
      </div>
    </div>
  );
}
