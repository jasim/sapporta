import { useCallback, useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { ColId, SortDescriptor } from "@sapporta/grid";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
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
  TGridRouteQuerySeed,
  TGridSession,
} from "@/table/state/tgrid-session";

type PersistedSort = Array<{ colId: string; direction: string }>;

// A table view can live at any route. Pass the page's navigate function so
// paging, sorting, filtering, and search update that same route.
export type TableGridNavigate = (
  url: string,
  options?: { replace?: boolean },
) => void;

// Connect one visible table level to the current URL.
export type UseTableGridUrlStateArgs<RowsByLevel extends TGridRowsByLevel> = {
  tableName: string;
  columns: readonly ColumnSchema[];
  searchParams: URLSearchParams;
  navigate: TableGridNavigate;
  level?: TGridLevelId<RowsByLevel>;
  routePath?: string;
  sortPreferenceKey?: string;
};

// Values a custom table page passes into `useTGridSession`.
// Use `syncSessionFromUrl` after router navigation so browser back/forward
// restores the table controls without remounting the page.
export type TableGridUrlStateBinding<RowsByLevel extends TGridRowsByLevel> = {
  routePath: string;
  level: TGridLevelId<RowsByLevel>;
  routeQuerySeeds: Partial<
    Record<TGridLevelId<RowsByLevel>, TGridRouteQuerySeed>
  >;
  onQueryUrlChange: CreateTGridSessionArgs<RowsByLevel>["onQueryUrlChange"];
  syncSessionFromUrl<AppServices>(
    session: TGridSession<RowsByLevel, AppServices>,
  ): void;
};

// Bind table controls to the page URL. URL sort wins; if the URL has no sort,
// the saved sort preference becomes the starting sort. Page, filters, and search
// only come from the URL so shared links open the same view for everyone.
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

  const routeQuerySeeds = useMemo(() => {
    const seed = tableQuerySeedFromUrlState({
      searchParams,
      parsed,
      sort: initialSort,
    });
    return {
      [levelId]: {
        ...seed,
      },
    } as unknown as Partial<
      Record<TGridLevelId<RowsByLevel>, TGridRouteQuerySeed>
    >;
  }, [
    initialSort,
    levelId,
    parsed.filters,
    parsed.page,
    parsed.search,
    searchParams,
  ]);

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
      const seed = tableQuerySeedFromUrlState({
        searchParams,
        parsed: params,
        sort: params.sort ?? loadSortPref(prefKey, validColIds),
      });
      const store = session.levels[levelId].queryStore as
        | StoreApi<TGridLevelQueryState<TGridTableRow>>
        | undefined;
      store?.getState().syncFromUrl(seed);
    },
    [levelId, prefKey, searchParams, validColIds],
  );

  return useMemo(
    () => ({
      routePath: effectiveRoutePath,
      level: levelId,
      routeQuerySeeds,
      onQueryUrlChange,
      syncSessionFromUrl,
    }),
    [
      effectiveRoutePath,
      routeQuerySeeds,
      levelId,
      onQueryUrlChange,
      syncSessionFromUrl,
    ],
  );
}

// Build a URL for the same table view with a different page number.
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
): SortDescriptor[] | undefined {
  const stored = loadPref<PersistedSort | null>(key, null);
  if (stored === null) return undefined;
  if (!Array.isArray(stored)) return [];
  return sanitizeSortDescriptors(stored, validColIds);
}

export function tableQuerySeedFromUrlState(args: {
  searchParams: URLSearchParams;
  parsed: {
    page: number;
    filters: FilterCondition[];
    search: string | null;
  };
  sort: SortDescriptor[] | undefined;
}): TGridRouteQuerySeed {
  // Only include values the route actually supplied. This lets a clean URL use
  // the level's configured defaults, while `?sort=` or `q=` can still clear them.
  const seed: TGridRouteQuerySeed = {};
  if (args.sort !== undefined) seed.sort = args.sort;
  if (hasPageParam(args.searchParams)) seed.page = args.parsed.page;
  if (hasFilterParams(args.searchParams)) seed.filters = args.parsed.filters;
  if (args.searchParams.has("q")) seed.search = args.parsed.search;
  return seed;
}

function hasPageParam(searchParams: URLSearchParams): boolean {
  return searchParams.has("page");
}

function hasFilterParams(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    if (key.startsWith("filter[")) return true;
  }
  return false;
}
