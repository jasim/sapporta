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
import { TGrid } from "./TGrid";
import { TableToolbar } from "./TableToolbar";
import { Pagination } from "@/table/pagination/Pagination";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { navigateToNewRecord } from "@/table/actions/record-actions";
import {
  parseTableSearchParams,
  buildTableSearchParams,
} from "@/table/url/table-url";
import { getNavigate } from "@/app/router/router-bridge";
import { loadPref, savePref } from "@/platform/prefs";
import type { ColId, SortDescriptor } from "@/grid";
import {
  createTGridSession,
  type TGridSession,
} from "@/table/state/tgrid-session";
import {
  buildSessionLevelsFromTableGridGraph,
  buildTableGridGraphFromSchema,
} from "@/table/grid-adapter/tgrid-schema-compiler";
import { startTGridLookupLoading } from "@/table/lookup/tgrid-lookup-loading";
import {
  registerTGridSession,
  unregisterTGridSession,
} from "@/table/state/tgrid-session-registry";

type SchemaDrivenRowsByLevel = Record<string, Record<string, unknown>>;

// Sort pref shape: a serializable mirror of `SortDescriptor[]`. Kept in
// localStorage under `sapporta:grid-sort:<tableName>` so it survives reloads.
type PersistedSort = Array<{ colId: string; direction: string }>;

// User entrypoint for table URLs (`/tables/:tableName`) that builds runtime.
// It compiles schema children into explicit levels, creates a session, and renders TGrid + controls.
// Table pages are schema-driven bootstrap paths:
// they derive an explicit TGrid level graph from `TableSchema.children` so
// nested tables keep working even without hand-written TGrid level declarations.
//
// This preserves the legacy "point table route at any table name" behavior while
// still honoring the explicit `rootLevel + levels + childLevels` contract in the
// TGrid runtime.
function sortPrefKey(tableName: string): string {
  return `sapporta:grid-sort:${tableName}`;
}

// Top-level entry for the table path. Owns:
//   - the URL-synced query store + REST-backed grid runtime (`TGridSession`)
//   - URL-store sync in both directions
//   - FK lookup loading
//   - drawer-create wiring + registry entry so external dispatchers can refetch
//   - layout: toolbar + grid + pagination + status bands (loading/error)
//
export function TablePage({ tableName }: { tableName: string }) {
  const tableSchema = useSchemaStore((s) =>
    s.tables.find((t) => t.name === tableName),
  );
  const tables = useSchemaStore((s) => s.tables);
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<
    TGridSession<SchemaDrivenRowsByLevel> | null
  >(null);

  const tablesByName = useMemo(
    () => Object.fromEntries(tables.map((table) => [table.name, table])),
    [tables],
  );

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

    // This is the compatibility compiler that turns schema child metadata into
    // the explicit level map expected by the session runtime.
    const sessionConfig = buildSessionLevelsFromTableGridGraph({
      graph: buildTableGridGraphFromSchema({
        rootTableName: tableSchema.name,
        tablesByName,
      }),
      rootLevelQuery: {
        initialSort,
        initialFilters: initial.filters,
        initialSearch: initial.search,
        initialPage: initial.page,
        urlSync: true,
      },
    });

    const nextSession = createTGridSession<SchemaDrivenRowsByLevel>({
      ...sessionConfig,
      onUrlChange: (state) => {
        if (state.level !== tableName) return;
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

    registerTGridSession(tableName, nextSession);
    const stopLookupLoading = startTGridLookupLoading(nextSession);
    setSession(nextSession);

    return () => {
      stopLookupLoading();
      unregisterTGridSession(tableName);
      nextSession.dispose();
      setSession(null);
    };
  }, [tableName, tableSchema, tablesByName]);

  // URL → store sync. Fires on browser back/forward and on our own URL
  // pushes (the store's equality guards in `syncFromUrl` suppress feedback
  // loops). Disabled until the session exists so we don't queue a sync
  // before the store is constructed.
  useEffect(() => {
    if (!session || !tableSchema) return;
    const validColIds: ReadonlySet<ColId> = new Set(
      tableSchema.columns.map((c) => c.name as ColId),
    );
    const params = parseTableSearchParams(searchParams, validColIds);
    session.queryStore.getState().syncFromUrl(params);
  }, [session, searchParams, tableSchema]);

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Schema for table '{tableName}' not loaded.
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }

  return <TablePageInner session={session} tableSchema={tableSchema} />;
}

// Splitting the inner component keeps the hook count stable across the
// "no schema yet" / "no session yet" early returns above. This component
// only mounts when both are present.
function TablePageInner({
  session,
  tableSchema,
}: {
  session: TGridSession<SchemaDrivenRowsByLevel>;
  tableSchema: TableSchema;
}) {
  const sort = useStore(session.queryStore, (s) => s.sort);
  const filters = useStore(session.queryStore, (s) => s.filters);
  const search = useStore(session.queryStore, (s) => s.search);
  const page = useStore(session.queryStore, (s) => s.page);
  const errorBanner = useStore(session.queryStore, (s) => s.errorBanner);

  // Source-driven chrome state. We subscribe to the source's snapshot
  // identity so loading/error/totalCount/pages flips wake exactly this
  // component (not the cell tree).
  const status = useSourceField(session, (s) => s.status);
  const errorObj = useSourceField(session, (s) => s.error);
  const totalCount = useSourceField(
    session,
    (s) => s.pagination?.totalCount ?? 0,
  );
  const pageSize = useStore(session.queryStore, (s) => s.pageSize);
  const pages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 0;

  const exportUrl = session.csvExportUrl();
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
        onAddFilter={(c) => session.queryStore.getState().addFilter(c)}
        onUpdateFilter={(id, p) =>
          session.queryStore.getState().updateFilter(id, p)
        }
        onRemoveFilter={(id) => session.queryStore.getState().removeFilter(id)}
        onSearchChange={(q) => session.queryStore.getState().setSearch(q)}
        onClearSort={() => session.queryStore.getState().clearSort()}
        onNewRecord={
          tableSchema.immutable
            ? undefined
            : () => navigateToNewRecord(tableSchema.name)
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
            onClick={() => session.queryStore.getState().setErrorBanner(null)}
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
            <TGrid runtime={session.runtime} sessionContext={session} />
          </div>
        </div>
      )}

      <Pagination
        page={page}
        pages={pages}
        onPageChange={(p) => session.queryStore.getState().setPage(p)}
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
  session: TGridSession,
  pick: (snap: ReturnType<TGridSession["rootSource"]["snapshot"]>) => T,
): T {
  return useSyncExternalStore(
    (cb) => session.rootSource.subscribe(cb),
    () => pick(session.rootSource.snapshot()),
  );
}
