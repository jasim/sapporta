import type { ReactNode } from "react";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  type TableToolbarSession,
  useTableToolbarSelection,
} from "./TableToolbarDeleteRowAction";
import { TableToolbarCompact } from "./TableToolbarCompact";
import { TableToolbarDesktop } from "./TableToolbarDesktop";
import { TableToolbarSelection } from "./TableToolbarSelection";
import { useResponsiveTableHeaderBand } from "./useResponsiveTableHeaderBand";

export type TableToolbarProps = {
  session?: TableToolbarSession;
  tableLabel: string;
  totalCount: number;
  columns: readonly ColumnSchema[];
  filters: readonly FilterCondition[];
  search: string | null;
  searchable: boolean;
  exportUrl: string;
  hasSort: boolean;
  onAddFilter: (cond: NewFilterCondition) => void;
  onUpdateFilter: (id: string, patch: NewFilterCondition) => void;
  onRemoveFilter: (id: string) => void;
  onSearchChange: (q: string | null) => void;
  onClearSort: () => void;
  onNewRecord?: () => void;
  viewControl?: ReactNode;
};

// Standard table controls as plain props.
// Use this component directly when your page already has toolbar props, or use
// `useTableToolbarProps` to bind it to a live table session.
export function TableToolbar(props: TableToolbarProps) {
  const { ref, band } = useResponsiveTableHeaderBand();
  const selection = useTableToolbarSelection(props.session);

  return (
    <div
      ref={ref}
      data-toolbar-band={band}
      className="group/table-toolbar shrink-0 bg-sap-surface"
    >
      {selection.kind !== "none" ? (
        <TableToolbarSelection {...props} selection={selection} />
      ) : band === "compact" ? (
        <TableToolbarCompact {...props} />
      ) : (
        <TableToolbarDesktop {...props} />
      )}
    </div>
  );
}
