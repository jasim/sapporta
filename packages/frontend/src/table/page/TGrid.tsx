import { useMemo, type CSSProperties } from "react";
import { Table2 } from "lucide-react";
import {
  trailingEdge,
  GridCopyContextMenu,
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
import { cn } from "@sapporta/ui/cn";
import { relatedRowsTableHref } from "../grid-adapter/tgrid-table-url";
import type { TGridFilter } from "../grid-adapter/tgrid-filter";
import type { TGridTableColumnMeta } from "../grid-adapter/tgrid-column-mapper";
import { renderTGridHeaderMenu } from "../grid-adapter/tgrid-header-menu";
import {
  withTGridSessionContext,
  type TGridSessionContext,
} from "../grid-adapter/tgrid-cell-context";
import type { TGridRowsByLevel } from "../grid-adapter/tgrid-types";
import type { TGridLevelQueryState } from "../state/tgrid-level-query-state";
import type { TGridSession } from "../state/tgrid-session";
import type { TGridLevelInfo } from "../grid-adapter/tgrid-level-config";
import "./table-card.css";

export type TGridPresentation = GridPresentation;

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
  presentation = "tabular",
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  className?: string;
  style?: CSSProperties;
  viewRelatedRows?: ViewRelatedRowsOption;
  presentation?: TGridPresentation;
}) {
  const runtime = session.runtime;
  const sessionContext = session as TGridRenderableSessionContext;
  const root = rootPath(runtime.schema.rootLevel);
  const chrome = useMemo(() => {
    const presetChrome = columnPreset.chrome<TGridTableColumnMeta, TGridFilter>(
      {
        columnSizing: {
          storageKey: ({ levelName }) =>
            `sapporta:grid-columns:${session.rootTableName}:${levelName}`,
        },
        renderColumnHeaderMenu: renderTGridHeaderMenu,
        commandOverrides: (level) => {
          const levelId = runtime.schemaAt(level.path).name;
          const queryStore = sessionContext.levels[levelId]?.queryStore as
            | { getState(): TGridLevelQueryState }
            | undefined;
          if (!queryStore) return {};
          // Header controls run against the concrete GridPath that rendered the
          // header. A level id names shared query state; a path names one loaded
          // source instance. Expanded child levels can have many paths, so sort,
          // filter, and page commands pass both values through the session.
          return {
            setSort: (sort) =>
              session.setLevelSort(levelId, level.path, sort ? [...sort] : []),
            setFilter: (filter) =>
              session.setLevelFilter(levelId, level.path, filter),
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
      <GridCopyContextMenu>
        {withTGridSessionContext(
          sessionContext as unknown as TGridSessionContext<
            TGridRowsByLevel,
            unknown
          >,
          <GridLevel path={root} chrome={chrome} presentation={presentation} />,
        )}
      </GridCopyContextMenu>
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
    renderHeader: (ctx) =>
      ctx.presentation === "cards" ? (
        renderCardsLevelHeader(session, ctx, root, viewRelatedRows)
      ) : (
        <>
          {chrome.renderHeader?.(ctx)}
          {renderRelatedRowsLink(session, ctx, root, viewRelatedRows)}
        </>
      ),
    renderStatus: (ctx) =>
      ctx.path === root ? null : chrome.renderStatus?.(ctx),
    renderEmpty: (ctx) =>
      ctx.path === root ? null : chrome.renderEmpty?.(ctx),
    levelContainerClassName: (ctx) =>
      cn(
        chrome.levelContainerClassName?.(ctx),
        // Table grids opt into editable chrome; report grids reuse the base
        // preset but keep their own readonly focus and surface treatment.
        "sapporta-table-grid--editable",
        ctx.path === root && className,
        ctx.path !== root &&
          viewRelatedRows &&
          "sapporta-table-grid--has-related-link",
      ),
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
      className="relative flex min-h-8 items-center justify-between gap-3 border-b border-sap-border/70 px-1 pb-2 pt-1"
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
        <RelatedRowsIconLink
          link={link}
          ariaLabel={relatedRowsLinkLabel(link, ctx)}
          className="absolute -left-9 top-0"
          dataGridPart="cards-level-link"
        />
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
    <RelatedRowsIconLink
      link={resolved}
      ariaLabel={relatedRowsLinkLabel(resolved, ctx)}
      className="absolute -left-11 top-0.5 z-[var(--sap-z-grid-header)]"
      dataGridPart="related-table-link"
    />
  );
}

function RelatedRowsIconLink({
  link,
  ariaLabel,
  className,
  dataGridPart,
}: {
  link: { href: string; label: string; target: "_self" | "_blank" };
  ariaLabel: string;
  className?: string;
  dataGridPart: string;
}) {
  return (
    <a
      href={link.href}
      target={link.target}
      rel={link.target === "_blank" ? "noreferrer" : undefined}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-sap-border bg-sap-surface text-sap-soft shadow-sm hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-focus-ring",
        className,
      )}
      data-grid-part={dataGridPart}
    >
      <Table2 aria-hidden="true" className="h-[15px] w-[15px]" />
    </a>
  );
}

function relatedRowsLinkLabel(
  link: { label: string },
  ctx: GridChromeContext,
): string {
  return `${link.label} (${compactLevelName(ctx.levelName)})`;
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
    label:
      config.label ??
      `View ${relatedTable.label ?? relatedTable.name} in table`,
    target: config.target ?? "_self",
  };
}

function compactLevelName(levelName: string): string {
  const dot = levelName.lastIndexOf(".");
  return dot >= 0 ? levelName.slice(dot + 1) : levelName;
}
