import { useState } from "react";
import {
  Download,
  ListFilter,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@sapporta/ui/sheet";
import { TopBar, TopBarButton } from "../../shell/components/TopBar";
import { FilterCardsBar } from "../filters/FilterCardsBar";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../grid-adapter/tgrid-types";
import type { TGridSession } from "../state/tgrid-session";
import { TableViewSwitch } from "./TableViewSwitch";
import {
  CompactHeaderButton,
  CompactHeaderLink,
  formatRecordCount,
  SearchInput,
} from "./TableHeaderControls";
import type { TablePageMode } from "./table-page-mode";
import type { TableViewPreference } from "./table-view-pref";
import { useTableLevelQuery, type TableLevelQuery } from "./table-level-query";
import { useTableSelection, type TableSelection } from "./table-selection";
import { useTGridSourceStatus } from "./tgrid-source-status";

export function TableGridHeader<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  mode,
  session,
  table,
  level,
  viewPreference,
  onViewPreferenceChange,
  onNewRecord,
}: {
  mode: TablePageMode;
  session: TGridSession<RowsByLevel, AppServices>;
  table: TableSchema;
  level: TGridLevelId<RowsByLevel>;
  viewPreference: TableViewPreference;
  onViewPreferenceChange: (view: TableViewPreference) => void;
  onNewRecord?: () => void;
}) {
  const query = useTableLevelQuery(session, level);
  const selection = useTableSelection(session);
  const status = useTGridSourceStatus(session);
  const totalCount = status.totalCount;

  if (selection.kind !== "none") {
    return (
      <SelectedRowsTableHeader
        table={table}
        totalCount={totalCount}
        selection={selection}
      />
    );
  }

  if (mode === "narrowCards") {
    return (
      <NarrowCardTableHeader
        table={table}
        totalCount={totalCount}
        query={query}
        exportUrl={session.csvExportUrl(level)}
        onNewRecord={onNewRecord}
      />
    );
  }

  return (
    <WideTableHeader
      table={table}
      totalCount={totalCount}
      query={query}
      exportUrl={session.csvExportUrl(level)}
      viewPreference={viewPreference}
      onViewPreferenceChange={onViewPreferenceChange}
      onNewRecord={onNewRecord}
    />
  );
}

function WideTableHeader({
  table,
  totalCount,
  query,
  exportUrl,
  viewPreference,
  onViewPreferenceChange,
  onNewRecord,
}: {
  table: TableSchema;
  totalCount: number;
  query: TableLevelQuery;
  exportUrl: string;
  viewPreference: TableViewPreference;
  onViewPreferenceChange: (view: TableViewPreference) => void;
  onNewRecord?: () => void;
}) {
  const tableLabel = table.label ?? table.name;

  return (
    <>
      <TopBar
        section="Tables"
        title={tableLabel}
        subtitle={formatRecordCount(totalCount)}
        actions={
          <>
            <TableViewSwitch
              value={viewPreference}
              onChange={onViewPreferenceChange}
            />
            {query.searchable && (
              <SearchInput value={query.search} onChange={query.setSearch} />
            )}
            {query.hasSort && (
              <TopBarButton
                tone="ghost"
                icon={<X className="h-[12px] w-[12px]" />}
                onClick={query.clearSort}
              >
                Clear sort
              </TopBarButton>
            )}
            <TopBarButton
              tone="ghost"
              href={exportUrl}
              download
              icon={<Download className="h-[12px] w-[12px]" />}
              shortcut="Cmd+E"
            >
              Export
            </TopBarButton>
            {onNewRecord && (
              <TopBarButton
                tone="primary"
                icon={<Plus className="h-[12px] w-[12px]" />}
                onClick={onNewRecord}
                shortcut="Cmd+N"
              >
                New record
              </TopBarButton>
            )}
          </>
        }
      />
      <FilterCardsBar
        columns={[...query.columns]}
        filters={[...query.filters]}
        lookupForColumn={query.lookupForColumn}
        onAdd={query.addFilter}
        onUpdate={query.updateFilter}
        onRemove={query.removeFilter}
      />
    </>
  );
}

function NarrowCardTableHeader({
  table,
  totalCount,
  query,
  exportUrl,
  onNewRecord,
}: {
  table: TableSchema;
  totalCount: number;
  query: TableLevelQuery;
  exportUrl: string;
  onNewRecord?: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tableLabel = table.label ?? table.name;
  const canFilter =
    query.columns.some((column) => !column.visuallyHidden) ||
    query.filters.length > 0;
  const filterLabel =
    query.activeFilterCount === 0
      ? "Filter"
      : `${query.activeFilterCount} filter${
          query.activeFilterCount === 1 ? "" : "s"
        }`;

  return (
    <div className="sticky top-0 z-[var(--sap-z-shell-sticky)] border-b border-sap-border-soft bg-sap-surface/95">
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1
              className="flex min-w-0 items-baseline gap-1.5 text-[16px] font-[720] leading-5 text-sap-fg"
              aria-label={`${tableLabel}, ${formatRecordCount(totalCount)}`}
            >
              <span className="min-w-0 truncate">{tableLabel}</span>
              <span className="shrink-0 text-sap-muted" aria-hidden="true">
                &middot;
              </span>
              <span
                className="mono shrink-0 text-[12px] font-[650] text-sap-muted"
                aria-hidden="true"
              >
                {totalCount.toLocaleString()}
              </span>
            </h1>
          </div>
          {onNewRecord && (
            <CompactHeaderButton
              aria-label="New record"
              title="New record"
              tone="primary"
              icon={<Plus className="h-4 w-4 shrink-0" />}
              onClick={onNewRecord}
              className="h-10 min-w-10 shrink-0 px-0"
            />
          )}
          <CompactHeaderButton
            aria-label="Open table actions"
            title="More actions"
            icon={<MoreHorizontal className="h-4 w-4" />}
            onClick={() => setActionsOpen(true)}
            className="h-10 min-w-10 shrink-0 px-0"
          />
        </div>

        {(query.searchable || canFilter) && (
          <div className="flex min-w-0 items-center gap-2">
            {query.searchable && (
              <div className="min-w-0 flex-1">
                <SearchInput
                  value={query.search}
                  onChange={query.setSearch}
                  compact
                />
              </div>
            )}
            {canFilter && (
              <CompactHeaderButton
                icon={<ListFilter className="h-4 w-4 shrink-0" />}
                onClick={() => setFiltersOpen(true)}
                className="h-10 shrink-0"
              >
                {filterLabel}
              </CompactHeaderButton>
            )}
          </div>
        )}
      </div>

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen}>
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
            {query.hasSort && (
              <CompactHeaderButton
                icon={<X className="h-4 w-4 shrink-0" />}
                onClick={() => {
                  query.clearSort();
                  setActionsOpen(false);
                }}
                className="w-full justify-start"
              >
                Clear sort
              </CompactHeaderButton>
            )}
            <CompactHeaderLink
              href={exportUrl}
              download
              icon={<Download className="h-4 w-4 shrink-0" />}
              onClick={() => setActionsOpen(false)}
              className="w-full justify-start"
            >
              Export
            </CompactHeaderLink>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[82vh] overflow-auto rounded-t-[8px] border-sap-border bg-sap-surface p-0"
        >
          <SheetHeader className="px-4 pb-2 pt-4 text-left">
            <SheetTitle className="text-[16px] text-sap-fg">Filters</SheetTitle>
            <SheetDescription className="text-sap-muted">
              {tableLabel}
            </SheetDescription>
          </SheetHeader>
          <FilterCardsBar
            columns={[...query.columns]}
            filters={[...query.filters]}
            lookupForColumn={query.lookupForColumn}
            onAdd={query.addFilter}
            onUpdate={query.updateFilter}
            onRemove={query.removeFilter}
            className="px-4 pb-5 pt-2"
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SelectedRowsTableHeader({
  table,
  totalCount,
  selection,
}: {
  table: TableSchema;
  totalCount: number;
  selection: Extract<TableSelection, { kind: "rows" }>;
}) {
  const tableLabel = table.label ?? table.name;

  return (
    <div className="sticky top-0 z-[var(--sap-z-shell-sticky)] border-b border-sap-border-soft bg-sap-surface/95 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-[720] leading-5 text-sap-fg">
            {selection.count} selected
          </h1>
          <p className="mono mt-[1px] truncate text-[11.5px] text-sap-muted">
            {tableLabel} - {formatRecordCount(totalCount)}
          </p>
        </div>
        <CompactHeaderButton
          tone="danger"
          icon={<Trash2 className="h-4 w-4 shrink-0" />}
          onClick={() => void selection.deleteSelected()}
        >
          Delete
        </CompactHeaderButton>
        <CompactHeaderButton
          aria-label="Clear row selection"
          title="Clear selection"
          icon={<X className="h-4 w-4" />}
          onClick={selection.clear}
          className="shrink-0 px-0"
        />
      </div>
    </div>
  );
}
