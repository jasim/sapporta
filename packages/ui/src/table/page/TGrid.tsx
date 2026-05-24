import { useMemo, type CSSProperties } from "react";
import {
  GridLevel,
  GridRuntimeProvider,
  rootPath,
  type GridLevelChrome,
  type GridRuntime,
} from "@/grid";
import { columnPreset } from "@/column-preset";
import { cn } from "@/ui/utils/cn";
import type { TGridFilter } from "@/table/grid-adapter/tgrid-filter";
import type { TGridTableColumnMeta } from "@/table/grid-adapter/tgrid-column-mapper";
import { renderTGridHeaderMenu } from "@/table/grid-adapter/tgrid-header-menu";
import {
  withTGridSessionContext,
  type TGridSessionContext,
} from "@/table/grid-adapter/tgrid-cell-context";
import type { TGridRowsByLevel } from "@/table/grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "@/table/state/tgrid-level-query-state";
import type { TGridSession } from "@/table/state/tgrid-session";

type TGridRenderableSessionContext = {
  rootLevel: string;
  runtime: GridRuntime;
  levels: Record<string, { queryStore?: unknown }>;
  appServices: unknown;
  lookupRegistry: TGridSessionContext<
    TGridRowsByLevel,
    unknown
  >["lookupRegistry"];
};

export function TGrid<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  className,
  style,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  className?: string;
  style?: CSSProperties;
}) {
  const runtime = session.runtime;
  const sessionContext = session as TGridRenderableSessionContext;
  const root = rootPath(runtime.schema.rootLevel);
  const chrome = useMemo(
    () => {
      const presetChrome = columnPreset.chrome<TGridTableColumnMeta, TGridFilter>({
        renderColumnHeaderMenu: renderTGridHeaderMenu,
        commandOverrides: (level) => {
          const queryStore = sessionContext.levels[runtime.schemaAt(level.path).name]
            ?.queryStore as
            | { getState(): TGridLevelQueryState }
            | undefined;
          if (!queryStore) return {};
          return {
            setSort: (sort) => queryStore.getState().setSort(sort ?? []),
            setFilter: (filter) => queryStore.getState().setFilter(filter),
            setPage: (page) => queryStore.getState().setPage(page),
          };
        },
      });
      return mergeTGridRootChrome(presetChrome, root, className, style);
    },
    [className, root, sessionContext, style],
  );

  return (
    <GridRuntimeProvider runtime={runtime}>
      {withTGridSessionContext(
        sessionContext as unknown as TGridSessionContext<TGridRowsByLevel, unknown>,
        <GridLevel path={root} chrome={chrome} />,
      )}
    </GridRuntimeProvider>
  );
}

function mergeTGridRootChrome(
  chrome: GridLevelChrome,
  root: string,
  className: string | undefined,
  style: CSSProperties | undefined,
): GridLevelChrome {
  return {
    renderLevelHeader: chrome.renderLevelHeader,
    levelContainerClassName: (ctx) =>
      cn(chrome.levelContainerClassName?.(ctx), ctx.path === root && className),
    levelContainerStyle: (ctx) => ({
      ...chrome.levelContainerStyle?.(ctx),
      ...(ctx.path === root ? style : undefined),
    }),
  };
}
