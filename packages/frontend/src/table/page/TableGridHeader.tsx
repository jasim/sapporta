import { useRef, useState } from "react";
import {
  Download,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@sapporta/ui/alert-dialog";
import { Button } from "@sapporta/ui/button";
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
import { useTableSelection } from "./table-selection";
import { useTGridSourceStatus } from "./tgrid-source-status";

type TableDeleteRequest = {
  count: number;
  deleteSelected: () => Promise<void>;
};

type TableDeleteControl = {
  count: number;
  onRequest: () => void;
};

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
  const [deleteRequest, setDeleteRequest] = useState<TableDeleteRequest | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteControl =
    !table.immutable && selection.kind === "rows"
      ? {
          count: selection.count,
          onRequest: () => {
            setDeleteRequest({
              count: selection.count,
              deleteSelected: selection.deleteSelected,
            });
            setDeleteDialogOpen(true);
          },
        }
      : undefined;

  const header =
    mode === "narrowCards" ? (
      <NarrowCardTableHeader
        table={table}
        totalCount={totalCount}
        query={query}
        exportUrl={session.csvExportUrl(level)}
        deleteControl={deleteControl}
        onNewRecord={onNewRecord}
      />
    ) : (
      <WideTableHeader
        table={table}
        totalCount={totalCount}
        query={query}
        exportUrl={session.csvExportUrl(level)}
        viewPreference={viewPreference}
        onViewPreferenceChange={onViewPreferenceChange}
        deleteControl={deleteControl}
        onNewRecord={onNewRecord}
      />
    );

  return (
    <>
      {header}
      <DeleteSelectedRowsDialog
        request={deleteRequest}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onClosed={() => setDeleteRequest(null)}
      />
    </>
  );
}

function WideTableHeader({
  table,
  totalCount,
  query,
  exportUrl,
  viewPreference,
  onViewPreferenceChange,
  deleteControl,
  onNewRecord,
}: {
  table: TableSchema;
  totalCount: number;
  query: TableLevelQuery;
  exportUrl: string;
  viewPreference: TableViewPreference;
  onViewPreferenceChange: (view: TableViewPreference) => void;
  deleteControl?: TableDeleteControl;
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
            {deleteControl && (
              <TopBarButton
                tone="danger"
                icon={<Trash2 className="h-[12px] w-[12px]" />}
                onClick={deleteControl.onRequest}
              >
                {deleteRowsLabel(deleteControl.count)}
              </TopBarButton>
            )}
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
  deleteControl,
  onNewRecord,
}: {
  table: TableSchema;
  totalCount: number;
  query: TableLevelQuery;
  exportUrl: string;
  deleteControl?: TableDeleteControl;
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
          {deleteControl ? (
            <CompactHeaderButton
              tone="danger"
              icon={<Trash2 className="h-4 w-4 shrink-0" />}
              onClick={deleteControl.onRequest}
              className="h-10 shrink-0"
            >
              {deleteRowsLabel(deleteControl.count)}
            </CompactHeaderButton>
          ) : (
            <>
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
            </>
          )}
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

function DeleteSelectedRowsDialog({
  request,
  open,
  onOpenChange,
  onClosed,
}: {
  request: TableDeleteRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);

  if (!request) return null;

  const deleteLabel = deleteRowsLabel(request.count);

  async function handleDelete(): Promise<void> {
    if (deletingRef.current || !request) return;
    deletingRef.current = true;
    setDeleting(true);

    try {
      await request.deleteSelected();
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      onOpenChange(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && deletingRef.current) {
          eventDetails.cancel();
          return;
        }
        onOpenChange(nextOpen);
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onClosed();
      }}
    >
      <AlertDialogContent aria-busy={deleting}>
        <AlertDialogHeader>
          <AlertDialogTitle>{deleteLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button type="button" variant="outline" />}
            disabled={deleting}
          >
            Cancel
          </AlertDialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            aria-busy={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            {deleting ? "Deleting…" : deleteLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function deleteRowsLabel(count: number): string {
  return `Delete ${count} row${count === 1 ? "" : "s"}`;
}
