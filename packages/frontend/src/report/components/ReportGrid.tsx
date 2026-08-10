import { useLayoutEffect, useMemo, type ReactNode } from "react";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  describeCellActivation,
  childPath,
  createGridRuntime,
  decomposePath,
  GridCopyContextMenu,
  GridLevel,
  GridRuntimeProvider,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  rowExpansionActivation,
  trailingEdge,
  treeNodeForRow,
  useGridRuntimeEffect,
  withRowExpansionColumn,
  type CellActivation,
  type CellActivationContext,
  type CellActivationGesture,
  type CellRenderProps,
  type CellActivationTrigger,
  type ColumnSchema,
  type GridCopyTarget,
  type GridPath,
  type GridSchema,
  type GridLevelChrome,
  type GridRuntime,
  type InMemoryLevelOpts,
  type LevelSchema,
  type TreeNode,
} from "@sapporta/grid";
import {
  columnPreset,
  columnPresetWidthForSizing,
} from "@sapporta/grid/column-preset";
import type { LinkIcon } from "@sapporta/shared/contracts";
import {
  gridDatasetLinkProblems,
  type GridDataset,
  type GridDatasetColumn,
  type GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
import { cn } from "@sapporta/ui/cn";
import { gridDatasetAncestorsForPath } from "../../grid-dataset/path";
import { catalogTableLabel } from "../../links/catalog-label";
import {
  isExternalHref,
  resolveLinks,
  type ResolvedLink,
} from "../../links/resolve-link";
import {
  handleResolvedLinkClick,
  linkRel,
  openResolvedLink,
} from "../../links/open-link";
import { LinkMenuItems } from "../../links/LinkMenuItems";
import "./ReportGrid.css";

export type ReportCellLink = {
  label: string;
  href: string;
  /** Menu-entry icon. Defaults to `external` for hrefs that leave the app,
   *  `drill-into` otherwise. */
  icon?: LinkIcon;
  target?: "_self" | "_blank";
};

export type ReportCellLinkContext<TInput = unknown> = {
  dataset: GridDataset;
  node: TreeNode;
  levelName: string;
  input: TInput | undefined;
  ancestors: GridDatasetNode[];
  column: GridDatasetColumn;
  value: unknown;
};

export type ReportRowLinkContext<TInput = unknown> = Omit<
  ReportCellLinkContext<TInput>,
  "column" | "value"
>;

export type ReportCellLinkResolvers<TInput = unknown> = Record<
  string,
  {
    cell?: Record<
      string,
      (context: ReportCellLinkContext<TInput>) => ReportCellLink[]
    >;
    /** Row-level links offered in the row's context menu. */
    row?: (context: ReportRowLinkContext<TInput>) => ReportCellLink[];
  }
>;

type ReportCellLinkCache = Map<string, ReportCellLink | null>;

type ReportGridBinding<TInput = unknown> = {
  dataset: GridDataset;
  runtime: GridRuntime;
  root: GridPath;
  links: ReportCellLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
};

interface ReportGridProps<TInput = unknown> {
  dataset: GridDataset;
  links?: ReportCellLinkResolvers<TInput>;
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
        session={{ dataset, runtime, root: runtime.root.path, links, input }}
      />
    </GridRuntimeProvider>
  );
}

function ReportGridBody<TInput>({
  session,
}: {
  session: ReportGridBinding<TInput>;
}) {
  const chrome = useReportGridChrome(session.dataset.name);

  useLayoutEffect(() => {
    expandDefaultReportRows(session.runtime, session.dataset);
  }, [session.dataset, session.runtime]);

  return (
    <GridCopyContextMenu
      renderExtraItems={(target) => renderReportLinkMenuItems(session, target)}
    >
      <div className="sapporta-report-tgrid min-w-full">
        <GridLevel path={session.root} chrome={chrome} presentation="tabular" />
      </div>
    </GridCopyContextMenu>
  );
}

function useReportGridChrome(reportName: string): GridLevelChrome {
  return useMemo<GridLevelChrome>(() => {
    const base = columnPreset.chrome({
      columnSizing: {
        storageKey: ({ levelName }) =>
          `sapporta:report-grid-columns:${reportName}:${levelName}`,
      },
    });
    return {
      ...base,
      levelContainerClassName: (context) =>
        cn(
          base.levelContainerClassName?.(context),
          "sapporta-report-tgrid__level",
        ),
    };
  }, [reportName]);
}

export interface ReportGridDatasetProps<TInput = unknown> {
  dataset: GridDataset;
  links?: ReportCellLinkResolvers<TInput>;
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
  links: ReportCellLinkResolvers<TInput> | undefined,
  input: TInput | undefined,
): {
  schema: GridSchema;
  dataSource: ReturnType<typeof inMemoryGridDataSource>;
} {
  // Binding is the first time the framework sees an app-built dataset, so
  // ill-formed declarative links fail loudly here — the counterpart of the
  // boot-time check on table-declared links. Left unchecked, a bind naming
  // a missing column would just never resolve, indistinguishable from rows
  // that legitimately lack the value.
  const linkProblems = gridDatasetLinkProblems(dataset);
  if (linkProblems.length > 0) {
    throw new Error(linkProblems.join("\n"));
  }

  const levels: Record<string, LevelSchema> = {};
  const sourceLevels: Record<string, InMemoryLevelOpts> = {};
  const linkCache: ReportCellLinkCache = new Map();

  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const visible = level.columns.filter(
      (column) => column.visuallyHidden !== true,
    );
    const expansionControlColumnId =
      level.childLevels.length > 0 ? (visible[0]?.id ?? null) : null;
    const columns = visible.map((column) =>
      gridColumnForDatasetColumn({
        dataset,
        levelName,
        column,
        isExpansionControlColumn: column.id === expansionControlColumnId,
        links,
        input,
        linkCache,
      }),
    );

    levels[levelName] = {
      name: level.label ?? levelName,
      columns,
      rowHeaderColumn: "none",
      options: {
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
      tree: dataset.nodes,
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
  const level = runtime.level(path);

  for (const node of nodes) {
    const childEntries = Object.entries(node.children ?? {});
    if (childEntries.length === 0) continue;

    level.expand(makeRowId(level.path, node.rowKey));
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
  isExpansionControlColumn,
  links,
  input,
  linkCache,
}: {
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  isExpansionControlColumn: boolean;
  links: ReportCellLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  linkCache: ReportCellLinkCache;
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
        links,
        input,
        linkCache,
      }),
  };

  const activatesPrimaryLink = canResolvePrimaryReportCellLink({
    links,
    levelName,
    column,
  });
  if (!activatesPrimaryLink) {
    return isExpansionControlColumn
      ? withRowExpansionColumn(reportColumn)
      : reportColumn;
  }

  const activation = reportCellPrimaryLinkActivation({
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
  links,
  input,
  linkCache,
}: {
  props: CellRenderProps;
  content: ReactNode;
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  links: ReportCellLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  linkCache: ReportCellLinkCache;
}): ReactNode {
  const primaryLink = resolvePrimaryReportCellLink({
    dataset,
    levelName,
    column,
    links,
    input,
    path: props.path,
    row: props.row,
    value: props.value,
  });
  linkCache.set(reportCellLinkCacheKey(props), primaryLink);

  if (!primaryLink) return content;
  return (
    <span
      className="sapporta-report-tgrid__linked-value"
      data-grid-part="report-linked-value"
    >
      <ReportCellPrimaryLink link={primaryLink}>
        {content}
      </ReportCellPrimaryLink>
    </span>
  );
}

/**
 * All links for one cell. An app-supplied resolver for the column takes
 * full control (including deliberately returning none); otherwise the
 * dataset column's declarative `links` resolve against the node's values.
 */
function resolveReportCellLinks<TInput>({
  dataset,
  levelName,
  column,
  links,
  input,
  path,
  row,
  value,
}: {
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  links: ReportCellLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  path: GridPath;
  row: CellRenderProps["row"];
  value: unknown;
}): ReportCellLink[] {
  const node = treeNodeForRow(row);
  if (!node) return [];

  const resolver = links?.[levelName]?.cell?.[column.id];
  if (resolver) {
    const ancestors = gridDatasetAncestorsForPath(dataset, path);
    return resolver({
      dataset,
      node,
      levelName,
      input,
      ancestors,
      column,
      value,
    });
  }
  return declarativeNodeLinks(column.links, node);
}

function resolvePrimaryReportCellLink<TInput>(args: {
  dataset: GridDataset;
  levelName: string;
  column: GridDatasetColumn;
  links: ReportCellLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
  path: GridPath;
  row: CellRenderProps["row"];
  value: unknown;
}): ReportCellLink | null {
  return resolveReportCellLinks(args)[0] ?? null;
}

/**
 * Declarative dataset links resolved against a node's `columns` values
 * (hidden helper ID columns included). Synthetic rows — opening, closing,
 * subtotal — never resolve declarative links: their values describe a
 * derived aggregate, not a navigable record.
 */
function declarativeNodeLinks(
  declared: GridDatasetColumn["links"],
  node: TreeNode,
): ResolvedLink[] {
  if (!declared?.length || node.kind !== undefined) return [];
  return resolveLinks(declared, {
    values: node.columns,
    tableLabel: catalogTableLabel,
  });
}

function canResolvePrimaryReportCellLink<TInput>({
  links,
  levelName,
  column,
}: {
  links: ReportCellLinkResolvers<TInput> | undefined;
  levelName: string;
  column: GridDatasetColumn;
}): boolean {
  const levelLinks = links?.[levelName];
  return Boolean(levelLinks?.cell?.[column.id]) || Boolean(column.links?.length);
}

/**
 * Context-menu contributions for the targeted report cell: every link the
 * cell resolves (not just the primary), then the row's links — an
 * app-supplied `row` resolver when present, else the level's declarative
 * `rowLinks`.
 */
function renderReportLinkMenuItems<TInput>(
  session: ReportGridBinding<TInput>,
  target: GridCopyTarget | null,
): ReactNode {
  if (!target) return null;

  let row: CellRenderProps["row"] | undefined;
  try {
    row = session.runtime
      .level(target.path)
      .displayedRow(target.selection.anchor.rowId);
  } catch {
    return null;
  }
  if (!row) return null;
  const node = treeNodeForRow(row);
  if (!node) return null;

  const edge = trailingEdge(target.path);
  const levelName = edge
    ? edge.childLevelName
    : decomposePath(target.path).rootLevelName;
  const level = session.dataset.levels[levelName];
  if (!level) return null;

  const column = level.columns.find(
    (c) => c.id === target.selection.anchor.colId,
  );
  const cellLinks = column
    ? resolveReportCellLinks({
        dataset: session.dataset,
        levelName,
        column,
        links: session.links,
        input: session.input,
        path: target.path,
        row,
        value: row.columns[column.id],
      })
    : [];

  const rowResolver = session.links?.[levelName]?.row;
  const rowLinks = rowResolver
    ? rowResolver({
        dataset: session.dataset,
        node,
        levelName,
        input: session.input,
        ancestors: gridDatasetAncestorsForPath(session.dataset, target.path),
      })
    : declarativeNodeLinks(level.rowLinks, node);

  return (
    <LinkMenuItems
      cellLinks={cellLinks.map(asResolvedLink)}
      rowLinks={rowLinks.map(asResolvedLink)}
    />
  );
}

/** Fills a link's optional fields with their documented defaults so menu
 *  rendering always has an icon and a target. */
function asResolvedLink(link: ReportCellLink | ResolvedLink): ResolvedLink {
  const target = link.target ?? "_self";
  return {
    href: link.href,
    label: link.label,
    icon:
      link.icon ??
      (target === "_blank" || isExternalHref(link.href)
        ? "external"
        : "drill-into"),
    target,
  };
}

function reportCellPrimaryLinkActivation({
  activatesExpansion,
  linkCache,
}: {
  activatesExpansion: boolean;
  linkCache: ReportCellLinkCache;
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

      const link = primaryCellActivationLink(linkCache, context);
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

      const link = primaryCellActivationLink(linkCache, context);
      if (link) {
        openReportCellLink(link);
        return;
      }
      expansionActivation?.run(context);
    },
  } satisfies CellActivation;
}

function primaryCellActivationLink(
  linkCache: ReportCellLinkCache,
  context: CellActivationContext,
): ReportCellLink | null {
  return linkCache.get(reportCellLinkCacheKey(context)) ?? null;
}

function isReportExpansionTrigger(trigger: CellActivationTrigger): boolean {
  return trigger.kind === "pointer" || trigger.gesture === "space";
}

function ReportCellPrimaryLink({
  link,
  children,
}: {
  link: ReportCellLink;
  children: ReactNode;
}) {
  return (
    <a
      href={link.href}
      target={link.target}
      tabIndex={-1}
      className="sapporta-report-tgrid__primary-link"
      rel={linkRel(link.target)}
      title={link.label}
      data-grid-part="report-primary-link"
      onClick={(event) =>
        handleResolvedLinkClick(event, {
          href: link.href,
          target: link.target ?? "_self",
        })
      }
    >
      {children}
    </a>
  );
}

function openReportCellLink(link: ReportCellLink) {
  openResolvedLink({ href: link.href, target: link.target ?? "_self" });
}

function reportCellLinkCacheKey({
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
