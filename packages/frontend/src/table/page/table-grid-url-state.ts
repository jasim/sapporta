import { useCallback, useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { ColId, SortDescriptor } from "@sapporta/grid";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { loadPref, savePref } from "@/platform/prefs";
import {
  buildTableSearchParams,
  parseTableSearchParams,
  sanitizeSortDescriptors,
} from "@/table/grid-adapter/tgrid-table-url";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "@/table/state/tgrid-level-query-state";
import type {
  CreateTGridSessionArgs,
  TGridHostQuerySeeds,
  TGridSession,
} from "@/table/state/tgrid-session";

type PersistedSort = Array<{ colId: string; direction: string }>;

// A table-like view owns its route. Pass the router's navigate function here so
// the grid can update links without knowing whether the page lives at
// `/tables/orders`, `/orders`, or a custom app route.
export type TableGridNavigate = (
  url: string,
  options?: { replace?: boolean },
) => void;

// Inputs needed to connect one visible table level to a URL.
// `searchParams` is read from the current route, while `navigate` writes the
// next URL after the user pages, sorts, filters, or searches.
export type UseTableGridUrlStateArgs<RowsByLevel extends TGridRowsByLevel> = {
  tableName: string;
  columns: readonly ColumnSchema[];
  searchParams: URLSearchParams;
  navigate: TableGridNavigate;
  level?: TGridLevelId<RowsByLevel>;
  routePath?: string;
  sortPreferenceKey?: string;
};

// The URL binding has two jobs:
// - seed the session from the current URL when the grid first mounts
// - keep the session and the URL in sync after user actions or back/forward
//
// The returned values are plain session inputs so a custom page can create its
// own layout while still using Sapporta's table URL behavior.
export type TableGridUrlStateBinding<RowsByLevel extends TGridRowsByLevel> = {
  routePath: string;
  level: TGridLevelId<RowsByLevel>;
  hostQuerySeeds: Partial<
    Record<TGridLevelId<RowsByLevel>, TGridHostQuerySeeds>
  >;
  onQueryUrlChange: CreateTGridSessionArgs<RowsByLevel>["onQueryUrlChange"];
  syncSessionFromUrl<AppServices>(
    session: TGridSession<RowsByLevel, AppServices>,
  ): void;
};

// Bind a host-owned table query to the caller's route.
// URL sort always wins. If the URL is silent about sort, the saved sort
// preference is used as a convenience default. Filters, search, and page come
// only from the URL so shared links open the same view for everyone.
export function useTableGridUrlState<RowsByLevel extends TGridRowsByLevel>({
  tableName,
  columns,
  searchParams,
  navigate,
  level,
  routePath,
  sortPreferenceKey,
}: UseTableGridUrlStateArgs<RowsByLevel>): TableGridUrlStateBinding<RowsByLevel> {
  const levelId = level ?? (tableName as TGridLevelId<RowsByLevel>);
  const effectiveRoutePath = routePath ?? `/tables/${tableName}`;
  const validColIds = useMemo<ReadonlySet<ColId>>(
    () => new Set(columns.map((column) => column.name as ColId)),
    [columns],
  );
  const prefKey = sortPreferenceKey ?? `sapporta:grid-sort:${tableName}`;
  const parsed = useMemo(
    () => parseTableSearchParams(searchParams, validColIds),
    [searchParams, validColIds],
  );
  const initialSort = useMemo(
    () => parsed.sort ?? loadSortPref(prefKey, validColIds),
    [parsed.sort, prefKey, validColIds],
  );

  const hostQuerySeeds = useMemo(
    () =>
      ({
        [levelId]: {
          sort: initialSort,
          filters: parsed.filters,
          search: parsed.search,
          page: parsed.page,
        },
      }) as unknown as Partial<
        Record<TGridLevelId<RowsByLevel>, TGridHostQuerySeeds>
      >,
    [initialSort, levelId, parsed.filters, parsed.page, parsed.search],
  );

  const onQueryUrlChange = useCallback<
    NonNullable<CreateTGridSessionArgs<RowsByLevel>["onQueryUrlChange"]>
  >(
    (state) => {
      if (state.level !== levelId) return;
      savePref<PersistedSort>(prefKey, state.sort);
      navigate(
        tableGridUrlForQueryState(effectiveRoutePath, state.page, state),
        {
          replace: true,
        },
      );
    },
    [effectiveRoutePath, levelId, navigate, prefKey],
  );

  const syncSessionFromUrl = useCallback(
    <AppServices>(session: TGridSession<RowsByLevel, AppServices>) => {
      const params = parseTableSearchParams(searchParams, validColIds);
      const store = session.levels[levelId].queryStore as
        | StoreApi<TGridLevelQueryState<TGridTableRow>>
        | undefined;
      store?.getState().syncFromUrl(params);
    },
    [levelId, searchParams, validColIds],
  );

  return useMemo(
    () => ({
      routePath: effectiveRoutePath,
      level: levelId,
      hostQuerySeeds,
      onQueryUrlChange,
      syncSessionFromUrl,
    }),
    [
      effectiveRoutePath,
      hostQuerySeeds,
      levelId,
      onQueryUrlChange,
      syncSessionFromUrl,
    ],
  );
}

// Build a link for the same table view with a different page number.
// The caller supplies `routePath` so built-in table pages and custom app pages
// use the same query string rules without sharing a route shape.
export function tableGridUrlForQueryState(
  routePath: string,
  page: number,
  state: Pick<
    TGridLevelQueryState<TGridTableRow>,
    "sort" | "filters" | "search"
  >,
): string {
  const params = buildTableSearchParams({
    page,
    sort: state.sort,
    filters: state.filters,
    search: state.search,
  });
  const queryString = params.toString();
  return `${routePath}${queryString ? `?${queryString}` : ""}`;
}

function loadSortPref(
  key: string,
  validColIds: ReadonlySet<ColId>,
): SortDescriptor[] {
  const stored = loadPref<PersistedSort>(key, []);
  if (!Array.isArray(stored)) return [];
  return sanitizeSortDescriptors(stored, validColIds);
}
