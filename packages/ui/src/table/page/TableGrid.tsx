import { useMemo } from "react";
import {
  GridLevel,
  GridRuntimeProvider,
  rootPath,
  type GridRuntime,
} from "@/grid";
import type { StoreApi } from "zustand";
import { columnPreset } from "@/column-preset";
import "@/grid/react/grid.css";
import type { TableState } from "@/table/state/table-state";
import type { TableFilter } from "@/table/grid-adapter/compile-table-grid";
import type { TableGridThemeColumnMeta } from "@/table/grid-adapter/table-grid-theme";
import { renderTableGridHeaderMenu } from "@/table/grid-adapter/table-grid-header-menu";

export function TableGrid({
  runtime,
  store,
}: {
  runtime: GridRuntime;
  store: StoreApi<TableState>;
}) {
  const root = rootPath(runtime.schema.rootLevel);
  const chrome = useMemo(
    () =>
      columnPreset.chrome<TableGridThemeColumnMeta, TableFilter>({
        renderColumnHeaderMenu: renderTableGridHeaderMenu,
        commandOverrides: (level) => {
          if (level.path !== root) return {};
          return {
            setSort: (sort) => store.getState().setSort(sort ?? []),
            setFilter: (filter) => store.getState().setTableFilter(filter),
            setPage: (page) => store.getState().setPage(page),
          };
        },
      }),
    [root, store],
  );

  return (
    <GridRuntimeProvider runtime={runtime}>
      <GridLevel path={root} chrome={chrome} />
    </GridRuntimeProvider>
  );
}
