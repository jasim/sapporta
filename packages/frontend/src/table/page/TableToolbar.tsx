import { useEffect, useState, type ReactNode } from "react";
import { Plus, Download, Search, X } from "lucide-react";
import { TopBar, TopBarButton } from "@/shell/components/TopBar";
import { FilterCardsBar } from "@/table/filters/FilterCardsBar";
import { useDebounce } from "@sapporta/ui";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  TableToolbarDeleteRowAction,
  type TableToolbarSession,
} from "./TableToolbarDeleteRowAction";

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
export function TableToolbar({
  session,
  tableLabel,
  totalCount,
  columns,
  filters,
  search,
  searchable,
  exportUrl,
  hasSort,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onSearchChange,
  onClearSort,
  onNewRecord,
  viewControl,
}: TableToolbarProps) {
  return (
    <>
      <TopBar
        section="Tables"
        title={tableLabel}
        subtitle={`${totalCount} record${totalCount !== 1 ? "s" : ""}`}
        actions={
          <>
            {viewControl}
            {searchable && (
              <SearchInput value={search} onChange={onSearchChange} />
            )}
            {hasSort && (
              <TopBarButton
                tone="ghost"
                icon={<X className="h-[12px] w-[12px]" />}
                onClick={onClearSort}
              >
                Clear sort
              </TopBarButton>
            )}
            <TopBarButton
              tone="ghost"
              href={exportUrl}
              download
              icon={<Download className="h-[12px] w-[12px]" />}
              shortcut="⌘E"
            >
              Export
            </TopBarButton>
            <TableToolbarDeleteRowAction session={session} />
            {onNewRecord && (
              <TopBarButton
                tone="primary"
                icon={<Plus className="h-[12px] w-[12px]" />}
                onClick={onNewRecord}
                shortcut="⌘N"
              >
                New record
              </TopBarButton>
            )}
          </>
        }
      />
      <FilterCardsBar
        columns={[...columns]}
        filters={[...filters]}
        onAdd={onAddFilter}
        onUpdate={onUpdateFilter}
        onRemove={onRemoveFilter}
      />
    </>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  // Keep typing instant, then publish the settled search term to the table.
  const [input, setInput] = useState(value ?? "");
  const debounced = useDebounce(input, 250);

  useEffect(() => {
    setInput(value ?? "");
  }, [value]);

  useEffect(() => {
    const normalized = debounced.trim() === "" ? null : debounced;
    if (normalized !== (value ?? null)) {
      onChange(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="relative flex items-center h-sap-ctl w-[260px] rounded-[6px] border border-sap-border bg-sap-surface pl-[28px] pr-[9px]">
      <Search className="absolute left-[9px] h-3 w-3 text-sap-subtle" />
      <input
        type="search"
        value={input}
        placeholder="Search…"
        className="flex-1 bg-transparent outline-none text-sap-emph text-sap-fg placeholder:text-sap-subtle"
        onChange={(e) => setInput(e.target.value)}
      />
    </div>
  );
}
