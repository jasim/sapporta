import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  trailingEdge,
  GridLevel,
  GridRuntimeProvider,
  rootPath,
  type GridChromeContext,
  type GridLevelChrome,
  type GridPresentation,
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

export type TGridView = GridPresentation | "auto";
export type TGridViewMode = TGridView;
type TGridViewportBand = "compact" | "expanded";

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
  view = "auto",
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  className?: string;
  style?: CSSProperties;
  viewRelatedRows?: ViewRelatedRowsOption;
  view?: TGridView;
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
  const viewport = useTGridViewportBand();
  const presentation = resolveTGridPresentation(view, viewport);

  return (
    <GridRuntimeProvider runtime={runtime}>
      {withTGridSessionContext(
        sessionContext as unknown as TGridSessionContext<
          TGridRowsByLevel,
          unknown
        >,
        <GridLevel path={root} chrome={chrome} presentation={presentation} />,
      )}
    </GridRuntimeProvider>
  );
}

function resolveTGridPresentation(
  view: TGridView,
  viewport: TGridViewportBand,
): GridPresentation {
  if (view !== "auto") return view;
  return viewport === "compact" ? "cards" : "tabular";
}

function useTGridViewportBand(): TGridViewportBand {
  const [band, setBand] = useState<TGridViewportBand>(() =>
    viewportBandForWidth(
      typeof window === "undefined" ? 1024 : window.innerWidth,
    ),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setBand(viewportBandForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return band;
}

function viewportBandForWidth(width: number): TGridViewportBand {
  return width < 768 ? "compact" : "expanded";
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
    renderLevelHeader: (ctx) =>
      ctx.presentation === "cards" ? (
        renderCardsLevelHeader(session, ctx, root, viewRelatedRows)
      ) : (
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

function renderCardsLevelHeader(
  session: TGridRenderableSessionContext,
  ctx: GridChromeContext,
  root: string,
  option: ViewRelatedRowsOption | undefined,
) {
  if (ctx.path === root) return null;
  const link = option ? resolveRelatedRowsLink(session, ctx, option) : null;

  return (
    <div
      className="flex min-h-8 items-center justify-between gap-3 border-b border-sap-border/70 px-1 pb-2 pt-1"
      data-grid-part="cards-level-header"
    >
      <div
        className="min-w-0 truncate text-[11px] font-bold uppercase tracking-sap-head text-sap-soft"
        data-grid-part="cards-level-title"
        title={ctx.levelName}
      >
        {compactLevelName(ctx.levelName)}
      </div>
      {link ? (
        <a
          href={link.href}
          target={link.target}
          rel={link.target === "_blank" ? "noreferrer" : undefined}
          className="shrink-0 text-xs font-medium text-sap-accent hover:underline"
          data-grid-part="cards-level-link"
        >
          {link.label}
        </a>
      ) : null}
    </div>
  );
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

function compactLevelName(levelName: string): string {
  const dot = levelName.lastIndexOf(".");
  return dot >= 0 ? levelName.slice(dot + 1) : levelName;
}
