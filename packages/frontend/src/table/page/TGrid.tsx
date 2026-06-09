import { useMemo, type CSSProperties } from "react";
import {
  trailingEdge,
  GridLevel,
  GridRuntimeProvider,
  rootPath,
  type GridChromeContext,
  type GridLevelChrome,
  type GridRuntime,
} from "@sapporta/grid";
import { columnPreset } from "@sapporta/grid/column-preset";
import type { TableSchema } from "@sapporta/shared/contracts";
import { cn } from "@sapporta/ui";
import { relatedRowsTableHref } from "@/table/grid-adapter/tgrid-table-url";
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
import type { TGridLevelInfo } from "@/table/grid-adapter/tgrid-level-config";

export type ViewRelatedRowsOption =
  | boolean
  | {
      label?: string;
      target?: "_self" | "_blank";
      href?: (context: ViewRelatedRowsContext) => string | null;
    };

export type ViewRelatedRowsContext = {
  parent: {
    table: TableSchema;
    levelId: string;
    rowId: string;
  };
  related: {
    table: TableSchema;
    levelId: string;
    foreignKey: string;
  };
  defaultHref: string;
};

type TGridRenderableSessionContext = {
  rootLevel: string;
  runtime: GridRuntime;
  levels: Record<string, { table?: TableSchema; queryStore?: unknown }>;
  levelInfoById: Record<string, TGridLevelInfo>;
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
  viewRelatedRows,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  className?: string;
  style?: CSSProperties;
  viewRelatedRows?: ViewRelatedRowsOption;
}) {
  const runtime = session.runtime;
  const sessionContext = session as TGridRenderableSessionContext;
  const root = rootPath(runtime.schema.rootLevel);
  const chrome = useMemo(() => {
    const presetChrome = columnPreset.chrome<TGridTableColumnMeta, TGridFilter>(
      {
        renderColumnHeaderMenu: renderTGridHeaderMenu,
        commandOverrides: (level) => {
          const queryStore = sessionContext.levels[
            runtime.schemaAt(level.path).name
          ]?.queryStore as { getState(): TGridLevelQueryState } | undefined;
          if (!queryStore) return {};
          return {
            setSort: (sort) => queryStore.getState().setSort(sort ?? []),
            setFilter: (filter) => queryStore.getState().setFilter(filter),
            setPage: (page) => queryStore.getState().setPage(page),
          };
        },
      },
    );
    return mergeTGridChrome({
      chrome: presetChrome,
      root,
      className,
      style,
      session: sessionContext,
      viewRelatedRows,
    });
  }, [className, root, sessionContext, style, viewRelatedRows]);

  return (
    <GridRuntimeProvider runtime={runtime}>
      {withTGridSessionContext(
        sessionContext as unknown as TGridSessionContext<
          TGridRowsByLevel,
          unknown
        >,
        <GridLevel path={root} chrome={chrome} />,
      )}
    </GridRuntimeProvider>
  );
}

function mergeTGridChrome({
  chrome,
  root,
  className,
  style,
  session,
  viewRelatedRows,
}: {
  chrome: GridLevelChrome;
  root: string;
  className: string | undefined;
  style: CSSProperties | undefined;
  session: TGridRenderableSessionContext;
  viewRelatedRows: ViewRelatedRowsOption | undefined;
}): GridLevelChrome {
  return {
    renderLevelHeader: (ctx) => (
      <>
        {chrome.renderLevelHeader?.(ctx)}
        {renderRelatedRowsLink(session, ctx, root, viewRelatedRows)}
      </>
    ),
    levelContainerClassName: (ctx) =>
      cn(chrome.levelContainerClassName?.(ctx), ctx.path === root && className),
    levelContainerStyle: (ctx) => ({
      ...chrome.levelContainerStyle?.(ctx),
      ...(ctx.path === root ? style : undefined),
    }),
  };
}

function renderRelatedRowsLink(
  session: TGridRenderableSessionContext,
  ctx: GridChromeContext,
  root: string,
  option: ViewRelatedRowsOption | undefined,
) {
  if (!option || ctx.path === root) return null;
  const resolved = resolveRelatedRowsLink(session, ctx, option);
  if (!resolved) return null;

  return (
    <div className="flex justify-end border-b border-sap-border bg-sap-surface-muted/40 px-3 py-1.5">
      <a
        href={resolved.href}
        target={resolved.target}
        rel={resolved.target === "_blank" ? "noreferrer" : undefined}
        className="text-xs font-medium text-sap-accent hover:underline"
      >
        {resolved.label}
      </a>
    </div>
  );
}

function resolveRelatedRowsLink(
  session: TGridRenderableSessionContext,
  ctx: GridChromeContext,
  option: ViewRelatedRowsOption,
): { href: string; label: string; target: "_self" | "_blank" } | null {
  const edge = trailingEdge(ctx.path);
  if (!edge) return null;

  const relatedLevel = session.levels[ctx.levelName];
  const relatedInfo = session.levelInfoById[ctx.levelName];
  const parentLevelId = relatedInfo?.parent?.parentLevelId;
  const parentLevel = parentLevelId ? session.levels[parentLevelId] : undefined;
  const parentTable = parentLevel?.table;
  const relatedTable = relatedLevel?.table;
  const foreignKey = relatedInfo?.parent?.foreignKey;
  if (!parentLevelId || !parentTable || !relatedTable || !foreignKey) {
    return null;
  }

  const config = typeof option === "object" ? option : {};
  const defaultHref = relatedRowsTableHref({
    tableName: relatedTable.name,
    foreignKey,
    parentRowId: String(edge.parentRowKey),
  });
  const context: ViewRelatedRowsContext = {
    parent: {
      table: parentTable,
      levelId: parentLevelId,
      rowId: String(edge.parentRowKey),
    },
    related: {
      table: relatedTable,
      levelId: ctx.levelName,
      foreignKey,
    },
    defaultHref,
  };
  const href = config.href ? config.href(context) : defaultHref;
  if (!href) return null;

  return {
    href,
    label: config.label ?? "View in table",
    target: config.target ?? "_self",
  };
}
