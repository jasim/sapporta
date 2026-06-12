import { Download, MoreHorizontal, Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@sapporta/ui";
import { useState } from "react";
import { FilterCardsBar } from "@/table/filters/FilterCardsBar";
import type { TableToolbarProps } from "./TableToolbar";
import {
  CompactToolbarButton,
  CompactToolbarLink,
  formatRecordCount,
  SearchInput,
} from "./TableToolbarControls";

export function TableToolbarCompact({
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
  const [overflowOpen, setOverflowOpen] = useState(false);

  return (
    <div className="sticky top-0 z-[var(--sap-z-shell-sticky)] border-b border-sap-border-soft bg-sap-surface/95">
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-[720] leading-6 text-sap-fg">
              {tableLabel}
            </h1>
            <p className="mono mt-[1px] text-[11.5px] text-sap-muted">
              {formatRecordCount(totalCount)}
            </p>
          </div>
          {onNewRecord && (
            <CompactToolbarButton
              tone="primary"
              icon={<Plus className="h-4 w-4 shrink-0" />}
              onClick={onNewRecord}
              className="shrink-0"
            >
              New
            </CompactToolbarButton>
          )}
        </div>

        {searchable && (
          <SearchInput value={search} onChange={onSearchChange} compact />
        )}

        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {viewControl}
          {hasSort && (
            <CompactToolbarButton
              icon={<X className="h-4 w-4 shrink-0" />}
              onClick={onClearSort}
              className="min-w-0 flex-1"
            >
              Clear sort
            </CompactToolbarButton>
          )}
          <CompactToolbarButton
            aria-label="Open table actions"
            title="More actions"
            icon={<MoreHorizontal className="h-4 w-4" />}
            onClick={() => setOverflowOpen(true)}
            className="ml-auto shrink-0 px-0"
          >
            <span className="sr-only">More actions</span>
          </CompactToolbarButton>
        </div>
      </div>

      <FilterCardsBar
        columns={[...columns]}
        filters={[...filters]}
        onAdd={onAddFilter}
        onUpdate={onUpdateFilter}
        onRemove={onRemoveFilter}
        className="overflow-hidden px-4 pb-3 pt-0"
      />

      <Sheet open={overflowOpen} onOpenChange={setOverflowOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[75vh] rounded-t-[8px] border-sap-border bg-sap-surface p-4"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-[16px] text-sap-fg">
              Table actions
            </SheetTitle>
            <SheetDescription className="text-sap-muted">
              {tableLabel}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid gap-2">
            <CompactToolbarLink
              href={exportUrl}
              download
              icon={<Download className="h-4 w-4 shrink-0" />}
              onClick={() => setOverflowOpen(false)}
              className="w-full justify-start"
            >
              Export
            </CompactToolbarLink>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
