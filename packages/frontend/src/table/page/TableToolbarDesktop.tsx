import { Download, Plus, X } from "lucide-react";
import { TopBar, TopBarButton } from "@/shell/components/TopBar";
import { FilterCardsBar } from "@/table/filters/FilterCardsBar";
import { TableToolbarDeleteRowAction } from "./TableToolbarDeleteRowAction";
import type { TableToolbarProps } from "./TableToolbar";
import { formatRecordCount, SearchInput } from "./TableToolbarControls";

export function TableToolbarDesktop({
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
        subtitle={formatRecordCount(totalCount)}
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
