import { useStore } from "zustand";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../grid-adapter/tgrid-types";
import type { TGridSession } from "../state/tgrid-session";
import { tableGridUrlForQueryState } from "./table-grid-url-state";
import { requireHostQueryStore } from "./table-query-store";
import { useTGridSourceStatus } from "./tgrid-source-status";

export type TableLevelPager = {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  hrefForPage?: (page: number) => string;
};

export function useTableLevelPager<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  level: TGridLevelId<RowsByLevel>,
  routePath: string,
): TableLevelPager {
  const store = requireHostQueryStore(session, level, "useTableLevelPager");
  const status = useTGridSourceStatus(session);
  const page = useStore(store, (state) => state.page);
  const pageSize = useStore(store, (state) => state.pageSize);
  const pages =
    status.totalCount > 0
      ? Math.max(1, Math.ceil(status.totalCount / pageSize))
      : 0;

  return {
    page,
    pages,
    onPageChange: (nextPage) => store.getState().setPage(nextPage),
    hrefForPage: (nextPage) =>
      tableGridUrlForQueryState(routePath, nextPage, store.getState()),
  };
}
