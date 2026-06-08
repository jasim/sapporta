import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import { TGrid } from "./TGrid";
import { TableToolbar } from "./TableToolbar";
import { Pagination } from "@/table/grid-adapter/Pagination";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { navigateToNewRecord } from "@/table/actions/record-actions";
import {
  buildTableSearchParams,
  parseTableSearchParams,
  sanitizeSortDescriptors,
} from "@/table/grid-adapter/tgrid-table-url";
import { getNavigate } from "@/app/router/router-bridge";
import { loadPref, savePref } from "@/platform/prefs";
import type { ColId, SortDescriptor } from "@sapporta/grid";
import { useTGridSession } from "@/table/grid-adapter/tgrid-binding";
import type { TGridSession } from "@/table/state/tgrid-session";
import { defineTGrid } from "@/table/grid-adapter/tgrid-runtime-config";
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

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        We could not find the schema for "{tableName}".
      </div>
    );
  }

  return (
    <TablePageWithSession
      tableName={tableName}
      tableSchema={tableSchema}
      tables={tables}
    />
  );
}

function TablePageWithSession({
  tableName,
  tableSchema,
  tables,
}: {
  tableName: string;
  tableSchema: TableSchema;
  tables: readonly TableSchema[];
}) {
  const [searchParams] = useSearchParams();

  const tablesByName = useMemo(
    () => Object.fromEntries(tables.map((table) => [table.name, table])),
    [tables],
  );

  const validColIds = useMemo<ReadonlySet<ColId>>(
    () => new Set((tableSchema?.columns ?? []).map((c) => c.name as ColId)),
    [tableSchema],
  );

  const initial = useMemo(
    () => parseTableSearchParams(searchParams, validColIds),
    [searchParams, validColIds],
  );

  const initialSort: SortDescriptor[] = useMemo(
    () =>
      initial.sort ??
      loadSortPref(sortPrefKey(tableName), validColIds),
    [initial.sort, tableName, validColIds],
  );

  const definition = useMemo(() => {
    const sessionConfig = buildSessionLevelsFromTableGridGraph({
      graph: buildTableGridGraphFromSchema({
        rootTableName: tableSchema.name,
        tablesByName,
      }),
      rootLevelQuery: {
        urlSync: true,
      },
    });
    return defineTGrid<SchemaDrivenRowsByLevel>(sessionConfig);
  }, [tableSchema, tablesByName]);

  const session = useTGridSession(definition, {
    onQueryUrlChange: (state) => {
      if (state.level !== tableName) return;
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
    hostQuerySeeds: {
      [tableName]: {
        sort: initialSort,
        filters: initial.filters,
        search: initial.search,
        page: initial.page,
      },
    },
  });

  useEffect(() => {
    if (!session) return;
    registerTGridSession(tableName, session);
    const stopLookupLoading = startTGridLookupLoading(session);
    return () => {
      stopLookupLoading();
      unregisterTGridSession(tableName);
    };
  }, [tableName, session]);

  // URL → store sync. Fires on browser back/forward and on our own URL
  // pushes (the store's equality guards in `syncFromUrl` suppress feedback
  // loops). Disabled until the session exists so we don't queue a sync
  // before the store is constructed.
  useEffect(() => {
    if (!session || !tableSchema) return;
    const params = parseTableSearchParams(searchParams, validColIds);
    session.queryStore.getState().syncFromUrl(params);
  }, [session, searchParams, tableSchema, validColIds]);

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
  const showSpinner = status === "loading" && totalCount === 0;
  const errorMessage =
    status === "error" ? tableLoadErrorMessage(errorObj) : null;

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
          {`Could not load ${tableSchema.label ?? tableSchema.name}: ${errorMessage}`}
        </div>
      )}

      {!showSpinner && !errorMessage && (
        <div className="flex-1 overflow-auto px-5 pb-7">
          <div className="bg-sap-surface">
            <TGrid session={session} />
          </div>
        </div>
      )}

      <Pagination
        page={page}
        pages={pages}
        onPageChange={(p) => session.queryStore.getState().setPage(p)}
        hrefForPage={(nextPage) => session.tablePageUrl(nextPage)}
      />
    </div>
  );
}

function tableLoadErrorMessage(err: unknown): string {
  if (err instanceof ApiError && isErrorBody(err.body)) {
    return err.body.error;
  }
  return err instanceof Error ? err.message : "Could not load rows.";
}

function loadSortPref(
  key: string,
  validColIds: ReadonlySet<ColId>,
): SortDescriptor[] {
  const stored = loadPref<PersistedSort>(key, []);
  if (!Array.isArray(stored)) return [];
  return sanitizeSortDescriptors(stored, validColIds);
}

function isErrorBody(value: unknown): value is {
  error: string;
  code?: string;
  details?: unknown;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

// Project a scalar field out of the source's snapshot. The source emits
// identity-stable snapshots, so React's `useSyncExternalStore` value-equality
// bailout keeps re-renders narrow: a status flip wakes only this component,
// not the cell tree.
function useSourceField<RowsByLevel extends SchemaDrivenRowsByLevel, T>(
  session: TGridSession<RowsByLevel>,
  pick: (
    snap: ReturnType<TGridSession<RowsByLevel>["rootSource"]["snapshot"]>,
  ) => T,
): T {
  return useSyncExternalStore(
    (cb) => session.rootSource.subscribe(cb),
    () => pick(session.rootSource.snapshot()),
  );
}
