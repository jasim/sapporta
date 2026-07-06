import { useLayoutEffect, useMemo, type ReactNode } from "react";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  describeCellActivation,
  childPath,
  createGridRuntime,
  GridCopyContextMenu,
  GridLevel,
  GridRuntimeProvider,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  rowExpansionActivation,
  useGridRuntimeEffect,
  withRowExpansionColumn,
  type CellActivation,
  type CellActivationContext,
  type CellActivationGesture,
  type CellRenderProps,
  type CellActivationTrigger,
  type ColumnSchema,
  type GridPath,
  type GridSchema,
  type GridLevelChrome,
  type GridRuntime,
  type InMemoryLevelOpts,
  type TreeNode,
} from "@sapporta/grid";
import {
  columnPreset,
  columnPresetWidthForSizing,
} from "@sapporta/grid/column-preset";
import type {
  GridDataset,
  GridDatasetColumn,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
import { cn } from "@sapporta/ui/cn";
import {
  gridDatasetAncestorsForPath,
  gridDatasetNodeForRow,
} from "../../grid-dataset/path";
import "./ReportGrid.css";

export type ReportGridLink = {
  label: string;
  href: string;
  kind?: "drill-down" | "record" | "route" | "external";
  icon?: "drill-up" | "drill-into" | "report" | "external";
  target?: "_self" | "_blank";
};

export type ReportGridLinkContext<TInput = unknown> = {
  dataset: GridDataset;
  node: GridDatasetNode;
  levelName: string;
  input: TInput | undefined;
  ancestors: GridDatasetNode[];
  column?: GridDatasetColumn;
  value?: unknown;
};

export type ReportGridLinkResolvers<TInput = unknown> = Record<
  string,
  {
    row?: (context: ReportGridLinkContext<TInput>) => ReportGridLink[];
    cell?: Record<
      string,
      (context: ReportGridLinkContext<TInput>) => ReportGridLink[]
    >;
  }
>;

type ReportGridLinkCache = Map<string, ReportGridLink | null>;

type ReportGridBinding = {
  dataset: GridDataset;
  runtime: GridRuntime;
  root: GridPath;
};

interface ReportGridProps<TInput = unknown> {
  dataset: GridDataset;
  links?: ReportGridLinkResolvers<TInput>;
  input?: TInput;
}

function ReportGrid<TInput = unknown>({
  dataset,
  links,
  input,
}: ReportGridProps<TInput>) {
  const runtime = useGridRuntimeEffect(() => {
    const model = buildReportGridModel(dataset, links, input);
    return createGridRuntime({
      schema: model.schema,
      dataSource: model.dataSource,
      interaction: CELL_GRID_WITH_ACTIVE_ROW,
    });
  }, [dataset, links, input]);

  if (!runtime) {
    return (
      <div className="sapporta-report-tgrid min-w-full text-sap-muted">
        Loading report...
      </div>
    );
  }

  return (
    <GridRuntimeProvider runtime={runtime}>
      <ReportGridBody
        session={{ dataset, runtime, root: rootPath(dataset.rootLevel) }}
      />
    </GridRuntimeProvider>
  );
}

function ReportGridBody({ session }: { session: ReportGridBinding }) {
  const chrome = useReportGridChrome();

  useLayoutEffect(() => {
    expandDefaultReportRows(session.runtime, session.dataset);
  }, [session.dataset, session.runtime]);

  return (
    <GridCopyContextMenu>
      <div className="sapporta-report-tgrid min-w-full">
        <GridLevel path={session.root} chrome={chrome} presentation="tabular" />
      </div>
    </GridCopyContextMenu>
  );
}

function useReportGridChrome(): GridLevelChrome {
  return useMemo<GridLevelChrome>(() => {
    const base = columnPreset.chrome();
    return {
      ...base,
      levelContainerClassName: (context) =>
        cn(
          base.levelContainerClassName?.(context),
          "sapporta-report-tgrid__level",
        ),
      levelContainerStyle: base.levelContainerStyle,
      renderHeader: base.renderHeader,
      renderStatus: base.renderStatus,
      renderEmpty: base.renderEmpty,
    };
  }, []);
}

export interface ReportGridDatasetProps<TInput = unknown> {
  dataset: GridDataset;
  links?: ReportGridLinkResolvers<TInput>;
  linkContext?: { input: TInput };
}

export function ReportGridDataset<TInput = unknown>({
  dataset,
  links,
  linkContext,
}: ReportGridDatasetProps<TInput>) {
  return (
    <ReportGrid dataset={dataset} links={links} input={linkContext?.input} />
  );
}

function buildReportGridModel<TInput>(
  dataset: GridDataset,
  links: ReportGridLinkResolvers<TInput> | undefined,
  input: TInput | undefined,
): {
  schema: GridSchema;
  dataSource: ReturnType<typeof inMemoryGridDataSource>;
} {
  const levels: GridSchema["levels"] = {};
  const sourceLevels: Record<string, InMemoryLevelOpts> = {};
  const linkCache: ReportGridLinkCache = new Map();

  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const visible = level.columns.filter(
      (column) => column.visuallyHidden !== true,
    );
    // Row-level links have no column identity, so render them once as a
    // fallback on the first visible cell. Column-specific cell resolvers still
    // own every column that has its own drill-down destination.
    const rowLinkFallbackColumnId = visible[0]?.id ?? null;
    const expansionControlColumnId =
      level.childLevels.length > 0 ? rowLinkFallbackColumnId : null;
    const columns = visible.map((column) =>
      gridColumnForDatasetColumn({
        dataset,
        levelName,
        column,
        isRowLinkFallbackColumn: column.id === rowLinkFallbackColumnId,
        isExpansionControlColumn: column.id === expansionControlColumnId,
        links,
        input,
        linkCache,
      }),
    );

    levels[levelName] = {
      name: level.label ?? levelName,
      columns,
      options: {
        rowKey: (node, localIdx) => node.rowKey ?? String(localIdx),
        defaultCollapsed: level.defaultCollapsed,
      },
      childLevels: [...level.childLevels],
    };
    sourceLevels[levelName] = {
      sortMode: "client",
      filterMode: "none",
      paginationMode: "none",
      readonly: true,
      footerRows:
        levelName === dataset.rootLevel ? dataset.footerRows : undefined,
    };
  }

  const schema = {
    rootLevel: dataset.rootLevel,
    levels,
  } satisfies GridSchema;

  return {
    schema,
    dataSource: inMemoryGridDataSource({
      schema,
      tree: dataset.nodes as TreeNode[],
      levels: sourceLevels,
    }),
  };
}

function expandDefaultReportRows(runtime: GridRuntime, dataset: GridDataset) {
  expandNodesAtPath({
    runtime,
    dataset,
    levelName: dataset.rootLevel,
    path: rootPath(dataset.rootLevel),
    nodes: dataset.nodes,
  });
}

function expandNodesAtPath({
  runtime,
  dataset,
  levelName,
  path,
  nodes,
}: {
  runtime: GridRuntime;
  dataset: GridDataset;
  levelName: string;
  path: GridPath;
  nodes: GridDatasetNode[];
}) {
  if (dataset.levels[levelName]?.defaultCollapsed === true) return;

  for (const node of nodes) {
    const childEntries = Object.entries(node.children ?? {});
    if (childEntries.length === 0) continue;

    runtime.coordinator.expand(path, makeRowId(path, node.rowKey));
    for (const [childLevelName, childNodes] of childEntries) {
      expandNodesAtPath({
        runtime,
        dataset,
        levelName: childLevelName,
        path: childPath(path, node.rowKey, childLevelName),
        nodes: childNodes,
      });
    }
  }
}

function gridColumnForDatasetColumn<TInput>({
  dataset,
  levelName,
  column,
  isRowLinkFallbackColumn,
  isExpansionControlColumn,
  links,
  input,
  linkCache,
}: {
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  isRowLinkFallbackColumn: boolean;
  isExpansionControlColumn: boolean;
  links: ReportGridLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  linkCache: ReportGridLinkCache;
}): ColumnSchema {
  const options = {
    id: column.id,
    name: column.label,
    width: columnPresetWidthForSizing(column),
    edit: "none" as const,
    sortable: column.sortable ?? true,
    colorRule: column.colorRule,
    zeroDisplay: column.zeroDisplay,
    strong: column.strong,
    display: column.textDisplay,
    meta: { reportColumn: column, displayType: column.kind },
  };

  let gridColumn: ColumnSchema;
  if (column.kind === "number" && column.displayFormat === "currency") {
    gridColumn = columnPreset.currency(options);
  } else if (
    column.kind === "number" &&
    column.displayFormat === "percentage"
  ) {
    gridColumn = columnPreset.percentage(options);
  } else if (column.kind === "number") {
    gridColumn = columnPreset.number(options);
  } else if (column.kind === "boolean") {
    gridColumn = columnPreset.boolean(options);
  } else if (column.kind === "date" || column.kind === "timestamp") {
    gridColumn = columnPreset.date(options);
  } else {
    gridColumn = columnPreset.text(options);
  }

  const renderCell = gridColumn.renderCell;
  const reportColumn = {
    ...gridColumn,
    renderCell: (props: CellRenderProps) =>
      renderReportCell({
        props,
        content: renderCell(props),
        dataset,
        levelName,
        column,
        isRowLinkFallbackColumn,
        links,
        input,
        linkCache,
      }),
  };

  const activatesPrimaryLink = canResolvePrimaryReportLink({
    links,
    levelName,
    columnId: column.id,
    isRowLinkFallbackColumn,
  });
  if (!activatesPrimaryLink) {
    return isExpansionControlColumn
      ? withRowExpansionColumn(reportColumn)
      : reportColumn;
  }

  const activation = reportGridPrimaryLinkActivation({
    activatesExpansion: isExpansionControlColumn,
    linkCache,
  });

  return isExpansionControlColumn
    ? withRowExpansionColumn(reportColumn, { activation })
    : { ...reportColumn, activation };
}

function renderReportCell<TInput>({
  props,
  content,
  dataset,
  levelName,
  column,
  isRowLinkFallbackColumn,
  links,
  input,
  linkCache,
}: {
  props: CellRenderProps;
  content: ReactNode;
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  isRowLinkFallbackColumn: boolean;
  links: ReportGridLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  linkCache: ReportGridLinkCache;
}): ReactNode {
  const primaryLink = resolvePrimaryReportGridLink({
    dataset,
    levelName,
    column,
    isRowLinkFallbackColumn,
    links,
    input,
    path: props.path,
    row: props.row,
    value: props.value,
  });
  linkCache.set(reportGridLinkCacheKey(props), primaryLink);

  if (!primaryLink) return content;
  return (
    <span
      className="sapporta-report-tgrid__linked-value"
      data-grid-part="report-linked-value"
    >
      <ReportGridPrimaryLink link={primaryLink}>
        {content}
      </ReportGridPrimaryLink>
    </span>
  );
}

function resolvePrimaryReportGridLink<TInput>({
  dataset,
  levelName,
  column,
  isRowLinkFallbackColumn,
  links,
  input,
  path,
  row,
  value,
}: {
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  isRowLinkFallbackColumn: boolean;
  links: ReportGridLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  path: GridPath;
  row: CellRenderProps["row"];
  value: unknown;
}): ReportGridLink | null {
  const node = gridDatasetNodeForRow(row);
  if (!node) return null;

  const ancestors = gridDatasetAncestorsForPath(dataset, path);
  const cellLinks =
    links?.[levelName]?.cell?.[column.id]?.({
      dataset,
      node,
      levelName,
      input,
      ancestors,
      column,
      value,
    }) ?? [];
  if (cellLinks.length > 0) return cellLinks[0] ?? null;

  if (!isRowLinkFallbackColumn) return null;

  const rowLinks =
    links?.[levelName]?.row?.({
      dataset,
      node,
      levelName,
      input,
      ancestors,
      column,
      value,
    }) ?? [];
  return rowLinks[0] ?? null;
}

function canResolvePrimaryReportLink<TInput>({
  links,
  levelName,
  columnId,
  isRowLinkFallbackColumn,
}: {
  links: ReportGridLinkResolvers<TInput> | undefined;
  levelName: string;
  columnId: string;
  isRowLinkFallbackColumn: boolean;
}): boolean {
  const levelLinks = links?.[levelName];
  return Boolean(
    levelLinks?.cell?.[columnId] ||
    (isRowLinkFallbackColumn && levelLinks?.row),
  );
}

function reportGridPrimaryLinkActivation({
  activatesExpansion,
  linkCache,
}: {
  activatesExpansion: boolean;
  linkCache: ReportGridLinkCache;
}): CellActivation {
  const startsOn: CellActivationGesture[] = ["enter"];
  if (activatesExpansion) startsOn.push("space");

  const expansionActivation = activatesExpansion
    ? rowExpansionActivation({ startsOn: ["space"] })
    : null;

  return {
    startsOn,
    describe: (context) => {
      if (expansionActivation && isReportExpansionTrigger(context.trigger)) {
        return describeCellActivation(expansionActivation, context);
      }

      const link = primaryActivationLink(linkCache, context);
      if (link) return { label: link.label, availability: { kind: "enabled" } };
      if (expansionActivation) {
        return describeCellActivation(expansionActivation, context);
      }
      return {
        label: "Open link",
        availability: {
          kind: "disabled",
          reason: "No drill-down link is available for this cell.",
        },
      };
    },
    run: (context) => {
      if (expansionActivation && isReportExpansionTrigger(context.trigger)) {
        expansionActivation.run(context);
        return;
      }

      const link = primaryActivationLink(linkCache, context);
      if (link) {
        openReportGridLink(link);
        return;
      }
      expansionActivation?.run(context);
    },
  } satisfies CellActivation;
}

function primaryActivationLink(
  linkCache: ReportGridLinkCache,
  context: CellActivationContext,
): ReportGridLink | null {
  return linkCache.get(reportGridLinkCacheKey(context)) ?? null;
}

function isReportExpansionTrigger(trigger: CellActivationTrigger): boolean {
  return trigger.kind === "pointer" || trigger.gesture === "space";
}

function ReportGridPrimaryLink({
  link,
  children,
}: {
  link: ReportGridLink;
  children: ReactNode;
}) {
  return (
    <a
      href={link.href}
      target={link.target}
      tabIndex={-1}
      className="sapporta-report-tgrid__primary-link"
      rel={linkRel(link)}
      title={link.label}
      data-grid-part="report-primary-link"
    >
      {children}
    </a>
  );
}

function linkRel(link: ReportGridLink): string | undefined {
  return link.target === "_blank" ? "noopener noreferrer" : undefined;
}

function openReportGridLink(link: ReportGridLink) {
  if (link.target === "_blank") {
    window.open(link.href, "_blank", "noopener,noreferrer");
    return;
  }
  window.location.assign(link.href);
}

function reportGridLinkCacheKey({
  path,
  row,
  column,
}: {
  path: GridPath;
  row: { id: string };
  column: { id: string };
}): string {
  return JSON.stringify([path, row.id, column.id]);
}
