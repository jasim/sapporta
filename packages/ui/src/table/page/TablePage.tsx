import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { TableGrid } from "./TableGrid";
import { TableToolbar } from "./TableToolbar";
import { Pagination } from "@/table/pagination/Pagination";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { openDrawerCreate } from "@/table/actions/record-actions";
import { getApiBase } from "@/platform/client";
import { buildRowsQuery } from "@/table/api/rows";
import {
  parseTableSearchParams,
  buildTableSearchParams,
} from "@/table/url/table-url";
import { getNavigate } from "@/app/router/router-bridge";
import { loadPref, savePref } from "@/platform/prefs";
import type { ColId, SortDescriptor } from "@/grid";
import { createTable, type TableHandle } from "@/table/state/table-state";
import { startTableLookupLoading } from "@/table/lookup/table-lookup-loading";
import { registerTable, unregisterTable } from "@/table/state/table-grid-registry";

// Sort pref shape: a serializable mirror of `SortDescriptor[]`. Kept in
// localStorage under `sapporta:grid-sort:<tableName>` so it survives reloads.
type PersistedSort = Array<{ colId: string; direction: string }>;

function sortPrefKey(tableName: string): string {
  return `sapporta:grid-sort:${tableName}`;
}

// Top-level entry for the table path. Owns:
//   - the URL-synced state store + REST-backed grid runtime (`TableHandle`)
//   - URL ↔ store sync (both directions)
//   - FK lookup loading
//   - drawer-create wiring + registry entry so external dispatchers can refetch
//   - layout: toolbar + grid + pagination + status bands (loading/error)
//
export function TablePage({ tableName }: { tableName: string }) {
  const tableSchema = useSchemaStore((s) =>
    s.tables.find((t) => t.name === tableName),
  );
  const tables = useSchemaStore((s) => s.tables);
  const tablesByName = useMemo(
    () => Object.fromEntries(tables.map((t) => [t.name, t])),
    [tables],
  );
  const [searchParams] = useSearchParams();
  const [handle, setHandle] = useState<TableHandle | null>(null);

  // Snapshot the URL once at construction so the initial fetch matches the
  // address bar. Subsequent URL changes flow through Effect 2 below.
  const initialParamsRef = useRef(searchParams);

  useEffect(() => {
    if (!tableSchema) return;
    const validColIds: ReadonlySet<ColId> = new Set(
      tableSchema.columns.map((c) => c.name as ColId),
    );
    const initial = parseTableSearchParams(
      initialParamsRef.current,
      validColIds,
    );
    // Sort precedence at mount: URL (when ?sort= present) > localStorage
    // preference > [].
    const initialSort: SortDescriptor[] =
      initial.sort ??
      (loadPref<PersistedSort>(sortPrefKey(tableName), []) as SortDescriptor[]);

    const h = createTable({
      tableName,
      tableSchema,
      tablesByName,
      initialSort,
      initialFilters: initial.filters,
      initialSearch: initial.search,
      initialPage: initial.page,
      onUrlChange: (state) => {
        // Persist the user's sort so it survives a reload.
        savePref<PersistedSort>(sortPrefKey(tableName), state.sort);
        const params = buildTableSearchParams({
          page: state.page,
          sort: state.sort,
          filters: state.filters,
          search: state.search,
        });
        const search = params.toString();
        const url = `/tables/${tableName}${search ? `?${search}` : ""}`;
        try {
          getNavigate()(url, { replace: true });
        } catch {
          // Router bridge not yet initialized.
        }
      },
    });

    registerTable(tableName, h);
    const stopLookupLoading = startTableLookupLoading(h);
    setHandle(h);

    return () => {
      stopLookupLoading();
      unregisterTable(tableName);
      h.dispose();
      setHandle(null);
    };
  }, [tableName, tableSchema, tablesByName]);

  // URL → store sync. Fires on browser back/forward and on our own URL
  // pushes (the store's equality guards in `syncFromUrl` suppress feedback
  // loops). Disabled until the handle exists so we don't queue a sync
  // before the store is constructed.
  useEffect(() => {
    if (!handle || !tableSchema) return;
    const validColIds: ReadonlySet<ColId> = new Set(
      tableSchema.columns.map((c) => c.name as ColId),
    );
    const params = parseTableSearchParams(searchParams, validColIds);
    handle.store.getState().syncFromUrl(params);
  }, [handle, searchParams, tableSchema]);

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Schema for table '{tableName}' not loaded.
      </div>
    );
  }

  if (!handle) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }

  return <TablePageInner handle={handle} tableSchema={tableSchema} />;
}

// Splitting the inner component keeps the hook count stable across the
// "no schema yet" / "no handle yet" early returns above. This component
// only mounts when both are present.
function TablePageInner({
  handle,
  tableSchema,
}: {
  handle: TableHandle;
  tableSchema: TableSchema;
}) {
  const sort = useStore(handle.store, (s) => s.sort);
  const filters = useStore(handle.store, (s) => s.filters);
  const search = useStore(handle.store, (s) => s.search);
  const page = useStore(handle.store, (s) => s.page);
  const errorBanner = useStore(handle.store, (s) => s.errorBanner);

  // Source-driven chrome state. We subscribe to the source's snapshot
  // identity so loading/error/totalCount/pages flips wake exactly this
  // component (not the cell tree).
  const status = useSourceField(handle, (s) => s.status);
  const errorObj = useSourceField(handle, (s) => s.error);
  const totalCount = useSourceField(
    handle,
    (s) => s.pagination?.totalCount ?? 0,
  );
  const pageSize = useStore(handle.store, (s) => s.pageSize);
  const pages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 0;

  const exportQueryString = new URLSearchParams(
    buildRowsQuery({ sort, filters, search: search ?? undefined }),
  ).toString();
  const exportUrl = `${getApiBase()}/tables/${tableSchema.name}/export.csv${exportQueryString ? `?${exportQueryString}` : ""}`;
  const hrefForPage = (nextPage: number): string => {
    const params = buildTableSearchParams({
      page: nextPage,
      sort,
      filters,
      search,
    });
    const queryString = params.toString();
    return `/tables/${tableSchema.name}${queryString ? `?${queryString}` : ""}`;
  };

  const showSpinner = status === "loading" && totalCount === 0;
  const errorMessage =
    status === "error"
      ? errorObj instanceof Error
        ? errorObj.message
        : "Failed to load rows"
      : null;

  return (
    <div className="flex flex-col h-full bg-sap-surface">
      <TableToolbar
        tableLabel={tableSchema.label ?? tableSchema.name}
        totalCount={totalCount}
        columns={tableSchema.columns}
        filters={filters}
        search={search}
        searchable={(tableSchema.search?.columns.length ?? 0) > 0}
        exportUrl={exportUrl}
        hasSort={sort.length > 0}
        onAddFilter={(c) => handle.store.getState().addFilter(c)}
        onUpdateFilter={(id, p) => handle.store.getState().updateFilter(id, p)}
        onRemoveFilter={(id) => handle.store.getState().removeFilter(id)}
        onSearchChange={(q) => handle.store.getState().setSearch(q)}
        onClearSort={() => handle.store.getState().clearSort()}
        onNewRecord={
          tableSchema.immutable
            ? undefined
            : () => openDrawerCreate(tableSchema.name)
        }
      />

      {errorBanner && (
        <div
          role="alert"
          className="flex items-start gap-3 border-b border-sap-negative/30 bg-sap-negative/10 px-4 py-2 text-sm text-sap-negative"
        >
          <pre className="flex-1 whitespace-pre-wrap font-sans">
            {errorBanner}
          </pre>
          <button
            type="button"
            onClick={() => handle.store.getState().setErrorBanner(null)}
            aria-label="Dismiss error"
            className="opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {showSpinner && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
        </div>
      )}

      {errorMessage && (
        <div className="flex-1 flex items-center justify-center text-sap-negative px-6 text-center">
          {`Failed to load ${tableSchema.label ?? tableSchema.name}: ${errorMessage}`}
        </div>
      )}

      {!showSpinner && !errorMessage && (
        <div className="flex-1 overflow-auto px-5 pb-7">
          <div className="bg-sap-surface">
            <TableGrid runtime={handle.runtime} store={handle.store} />
          </div>
        </div>
      )}

      <Pagination
        page={page}
        pages={pages}
        onPageChange={(p) => handle.store.getState().setPage(p)}
        hrefForPage={hrefForPage}
      />
    </div>
  );
}

// Project a scalar field out of the source's snapshot. The source emits
// identity-stable snapshots, so React's `useSyncExternalStore` value-equality
// bailout keeps re-renders narrow: a status flip wakes only this component,
// not the cell tree.
function useSourceField<T>(
  handle: TableHandle,
  pick: (snap: ReturnType<TableHandle["source"]["snapshot"]>) => T,
): T {
  return useSyncExternalStore(
    (cb) => handle.source.subscribe(cb),
    () => pick(handle.source.snapshot()),
  );
}
