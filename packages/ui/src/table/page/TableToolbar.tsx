import { useEffect, useState } from "react";
import { Plus, Download, Search, X } from "lucide-react";
import { TopBar, TopBarButton } from "@/shell/components/TopBar";
import { FilterCardsBar } from "@/table/filters/FilterCardsBar";
import { useDebounce } from "@/ui/hooks/useDebounce";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";

// Toolbar for the table path. Deliberately decoupled from
// `TableController` — every value is a plain prop. Multi-row delete UI is
// not wired here yet; that requires runtime selection plumbing the new
// grid does not expose, and the goal is parity with what the new path
// actually supports today.
export function TableToolbar({
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
}: {
  tableLabel: string;
  totalCount: number;
  columns: ColumnSchema[];
  filters: FilterCondition[];
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
}) {
  return (
    <>
      <TopBar
        section="Tables"
        title={tableLabel}
        subtitle={`${totalCount} record${totalCount !== 1 ? "s" : ""}`}
        actions={
          <>
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
        columns={columns}
        filters={filters}
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
  // Local state drives the input so keystrokes feel instant; the debounced
  // value is what we push up to the store.
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
