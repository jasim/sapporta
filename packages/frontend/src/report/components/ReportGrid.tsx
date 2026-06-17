import { useEffect, useMemo, type ReactNode } from "react";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  childPath,
  createGridRuntime,
  ExpandCell,
  GridLevel,
  GridRuntimeProvider,
  inMemoryGridDataSource,
  makeRowId,
  rootPath,
  trailingEdge,
  type CellRenderProps,
  type ColumnSchema,
  type GridPath,
  type GridSchema,
  type GridLevelChrome,
  type GridRuntime,
  type InMemoryLevelOpts,
  type LevelRow,
  type TreeNode,
} from "@sapporta/grid";
import { columnPreset, type ColumnWidth } from "@sapporta/grid/column-preset";
import type {
  GridDataset,
  GridDatasetColumn,
  GridDatasetFooterRow,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
import { cn } from "@sapporta/ui";
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

export type ReportGridFooterLinkContext<TInput = unknown> = {
  dataset: GridDataset;
  footerRow: GridDatasetFooterRow;
  input: TInput | undefined;
};

export type ReportGridLinkResolvers<TInput = unknown> = Record<
  string,
  {
    row?: (context: ReportGridLinkContext<TInput>) => ReportGridLink[];
    cell?: Record<
      string,
      (context: ReportGridLinkContext<TInput>) => ReportGridLink[]
    >;
    footer?: (
      context: ReportGridFooterLinkContext<TInput>,
    ) => ReportGridLink[];
  }
>;

interface ReportGridProps<TInput = unknown> {
  dataset: GridDataset;
  links?: ReportGridLinkResolvers<TInput>;
  input?: TInput;
}

export function ReportGrid<TInput = unknown>({
  dataset,
  links,
  input,
}: ReportGridProps<TInput>) {
  const model = useMemo(
    () => buildReportGridModel(dataset, links, input),
    [dataset, links, input],
  );
  const runtime = useMemo(
    () => {
      const next = createGridRuntime({
        schema: model.schema,
        dataSource: model.dataSource,
        interaction: CELL_GRID_WITH_ACTIVE_ROW,
      });
      expandDefaultReportRows(next, dataset);
      return next;
    },
    [model],
  );
  const chrome = useMemo<GridLevelChrome>(() => {
    const base = columnPreset.chrome();
    return {
      ...base,
      levelContainerClassName: (context) =>
        cn(
          base.levelContainerClassName?.(context),
          "sapporta-report-tgrid__level",
        ),
      levelContainerStyle: base.levelContainerStyle,
      renderLevelHeader: base.renderLevelHeader,
    };
  }, []);

  useEffect(() => () => runtime.dispose(), [runtime]);

  return (
    <div className="sapporta-report-tgrid min-w-full">
      <GridRuntimeProvider runtime={runtime}>
        <GridLevel
          path={rootPath(dataset.rootLevel)}
          chrome={chrome}
          presentation="tabular"
        />
      </GridRuntimeProvider>
    </div>
  );
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

  for (const [levelName, level] of Object.entries(dataset.levels)) {
    const visible = level.columns.filter(
      (column) => column.visuallyHidden !== true,
    );
    const columns = visible.map((column) =>
      gridColumnForDatasetColumn({
        dataset,
        column,
        links,
        input,
      }),
    );

    if (level.childLevels.length > 0 && columns.length > 0) {
      columns[0] = expandableColumn(columns[0]);
    }

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

    runtime.coordinator.toggleExpand(path, makeRowId(path, node.rowKey));
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
  column,
  links,
  input,
}: {
  dataset: GridDataset;
  column: GridDatasetColumn;
  links: ReportGridLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
}): ColumnSchema {
  const options = {
    id: column.id,
    name: column.label,
    width: widthForColumn(column),
    editable: false,
    sortable: column.sortable ?? true,
    editTriggers: [],
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
  return {
    ...gridColumn,
    renderCell: (props: CellRenderProps) =>
      renderReportCell({
        props,
        content: renderCell(props),
        dataset,
        column,
        links,
        input,
      }),
  };
}

function expandableColumn(column: ColumnSchema): ColumnSchema {
  const renderCell = column.renderCell;
  return {
    ...column,
    controlsRowExpansion: true,
    renderCell: (props) => (
      <ExpandCell row={props.row} path={props.path}>
        {renderCell(props)}
      </ExpandCell>
    ),
  };
}

function renderReportCell<TInput>({
  props,
  content,
  dataset,
  column,
  links,
  input,
}: {
  props: CellRenderProps;
  content: ReactNode;
  dataset: GridDataset;
  column: GridDatasetColumn;
  links: ReportGridLinkResolvers<TInput> | undefined;
  input: TInput | undefined;
}): ReactNode {
  const levelName =
    trailingEdge(props.path)?.childLevelName ?? dataset.rootLevel;
  const footerRow = footerRowFor(props.row);
  const footerLinks = footerRow
    ? (links?.[levelName]?.footer?.({ dataset, footerRow, input }) ?? [])
    : [];
  const node = nodeForRow(props.row);
  const ancestors = node ? ancestorsForPath(dataset, props.path) : [];
  const rowLinks = node
    ? (links?.[levelName]?.row?.({
        dataset,
        node,
        levelName,
        input,
        ancestors,
      }) ?? [])
    : [];
  const cellLinks = node
    ? (links?.[levelName]?.cell?.[column.id]?.({
        dataset,
        node,
        levelName,
        input,
        ancestors,
        column,
        value: props.value,
      }) ?? [])
    : [];
  const link =
    (cellLinks.length > 0 ? cellLinks : footerLinks)[0] ?? rowLinks[0];
  if (!link) return content;
  return (
    <a
      href={link.href}
      target={link.target}
      className="min-w-0 text-sap-brand hover:underline"
      rel={link.target === "_blank" ? "noreferrer" : undefined}
      title={link.label}
    >
      {content}
    </a>
  );
}

function widthForColumn(column: GridDatasetColumn): ColumnWidth | undefined {
  if (column.width) return { track: `${column.width}ch` };
  if (column.minWidth || column.maxWidth) {
    const min = column.minWidth ? column.minWidth * 8 : undefined;
    const max = column.maxWidth ? column.maxWidth * 8 : undefined;
    return { min, max };
  }
  return undefined;
}

function footerRowFor(row: LevelRow): GridDatasetFooterRow | null {
  if (row.kind !== "footer") return null;
  return row.source;
}

function nodeForRow(row: LevelRow): GridDatasetNode | null {
  if (row.kind === "footer" || row.kind === "phantom") return null;
  return row.source as GridDatasetNode;
}

function ancestorsForPath(
  dataset: GridDataset,
  path: GridPath,
): GridDatasetNode[] {
  const edges = edgesForPath(path);
  const ancestors: GridDatasetNode[] = [];
  let nodes: GridDatasetNode[] = dataset.nodes;

  for (const edge of edges) {
    const parent = nodes.find((node) => node.rowKey === edge.parentRowKey);
    if (!parent) return ancestors;
    ancestors.push(parent);
    nodes = parent.children?.[edge.childLevelName] ?? [];
  }

  return ancestors;
}

function edgesForPath(path: GridPath): Array<{
  parentRowKey: string;
  childLevelName: string;
}> {
  const reversed: Array<{ parentRowKey: string; childLevelName: string }> = [];
  let cursor = path;
  let edge = trailingEdge(cursor);
  while (edge) {
    reversed.push({
      parentRowKey: edge.parentRowKey,
      childLevelName: edge.childLevelName,
    });
    cursor = edge.parentPath;
    edge = trailingEdge(cursor);
  }
  return reversed.reverse();
}
