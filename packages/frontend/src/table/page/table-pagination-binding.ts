import { useStore } from "zustand";
import type { PaginationProps } from "@/table/grid-adapter/Pagination";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridSession } from "@/table/state/tgrid-session";
import { tableGridUrlForQueryState } from "./table-grid-url-state";
import { requireHostQueryStore } from "./table-toolbar-binding";

// Inputs needed to render pagination for the visible table level.
// `routePath` is the path for the current page without a query string; page
// links are built by adding the current sort, filters, and search.
export type UseTablePaginationPropsArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  totalCount: number;
  routePath: string;
  level?: TGridLevelId<RowsByLevel>;
};

// Convert the current query state and row count into props for `Pagination`.
// The links it returns preserve the rest of the query so a user can open, copy,
// or command-click pages without losing filters or search.
export function useTablePaginationProps<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  totalCount,
  level,
  routePath,
}: UseTablePaginationPropsArgs<RowsByLevel, AppServices>): PaginationProps {
  const levelId = level ?? session.rootLevel;
  const store = requireHostQueryStore(
    session,
    levelId,
    "useTablePaginationProps",
  );
  const page = useStore(store, (state) => state.page);
  const pageSize = useStore(store, (state) => state.pageSize);
  const pages =
    totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 0;

  return {
    page,
    pages,
    onPageChange: (nextPage) => store.getState().setPage(nextPage),
    hrefForPage: (nextPage) =>
      tableGridUrlForQueryState(routePath, nextPage, store.getState()),
  };
}
