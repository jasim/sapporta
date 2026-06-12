import type { ReactNode } from "react";
import type {
  GridColumn,
  GridFooterRow,
  GridReportNode,
  GridReportResult as GridReportResultData,
} from "@sapporta/shared/report-grid";
import { cn } from "@sapporta/ui";

export type ReportGridLink = {
  label: string;
  href: string;
  kind?: "drill-down" | "record" | "route" | "external";
  icon?: "drill-up" | "drill-into" | "report" | "external";
  target?: "_self" | "_blank";
};

export type ReportGridLinkContext<TInput = unknown> = {
  result: GridReportResultData;
  node: GridReportNode;
  levelName: string;
  input: TInput;
  ancestors: GridReportNode[];
  column?: GridColumn;
  value?: unknown;
};

export type ReportGridFooterLinkContext<TInput = unknown> = {
  result: GridReportResultData;
  footerRow: GridFooterRow;
  input: TInput;
};

export type ReportGridLinkResolvers<TInput = unknown> = Record<
  string,
  {
    row?: (context: ReportGridLinkContext<TInput>) => ReportGridLink[];
    cell?: Record<
      string,
      (context: ReportGridLinkContext<TInput>) => ReportGridLink[]
    >;
    footer?: (context: ReportGridFooterLinkContext<TInput>) => ReportGridLink[];
  }
>;

interface ReportGridProps {
  result: GridReportResultData;
  nodes: GridReportNode[];
  levelColumns: Record<string, GridColumn[]>;
  levelName?: string;
  footerRows?: GridFooterRow[];
  levelOptions?: Record<string, { defaultCollapsed?: boolean }>;
  links?: ReportGridLinkResolvers;
  linkContext?: unknown;
  ancestors?: GridReportNode[];
}

export function ReportGrid(props: ReportGridProps) {
  const levelName = props.levelName ?? props.nodes[0]?.levelName;
  const columns = visibleColumns(
    levelName ? (props.levelColumns[levelName] ?? []) : [],
  );

  return (
    <div className="min-w-full text-sap-data">
      {columns.length > 0 ? (
        <div
          className="sticky top-0 z-10 grid border-b border-sap-border bg-sap-chip text-sap-micro font-medium uppercase tracking-sap-label text-sap-subtle"
          style={{ gridTemplateColumns: templateColumns(columns) }}
        >
          {columns.map((column) => (
            <div key={column.name} className="px-[10px] py-[7px]">
              {column.label}
            </div>
          ))}
        </div>
      ) : null}
      <div>
        {props.nodes.map((node, index) => (
          <ReportGridNode
            key={`${node.levelName}:${index}`}
            result={props.result}
            node={node}
            levelColumns={props.levelColumns}
            links={props.links}
            linkContext={props.linkContext}
            ancestors={props.ancestors ?? []}
            depth={props.ancestors?.length ?? 0}
          />
        ))}
        {props.footerRows?.map((footerRow, index) => (
          <ReportFooter
            key={`footer:${index}`}
            result={props.result}
            footerRow={footerRow}
            columns={columns}
            links={props.links?.[levelName ?? ""]?.footer}
            linkContext={props.linkContext}
          />
        ))}
      </div>
    </div>
  );
}

export interface ReportGridResultProps<TInput = unknown> {
  result: GridReportResultData;
  links?: ReportGridLinkResolvers<TInput>;
  linkContext?: { input: TInput };
}

export function ReportGridResult<TInput = unknown>({
  result,
  links,
  linkContext,
}: ReportGridResultProps<TInput>) {
  return (
    <ReportGrid
      result={result}
      nodes={result.data}
      levelColumns={result.levelColumns}
      footerRows={result.footerRows}
      levelOptions={result.levelOptions}
      links={links as ReportGridLinkResolvers}
      linkContext={linkContext?.input}
    />
  );
}

function ReportGridNode({
  result,
  node,
  levelColumns,
  links,
  linkContext,
  ancestors,
  depth,
}: {
  result: GridReportResultData;
  node: GridReportNode;
  levelColumns: Record<string, GridColumn[]>;
  links?: ReportGridLinkResolvers;
  linkContext?: unknown;
  ancestors: GridReportNode[];
  depth: number;
}) {
  const columns = visibleColumns(levelColumns[node.levelName] ?? []);
  const rowLinks =
    links?.[node.levelName]?.row?.({
      result,
      node,
      levelName: node.levelName,
      input: linkContext,
      ancestors,
    }) ?? [];

  return (
    <div>
      <div
        className={cn(
          "grid border-b border-sap-border hover:bg-sap-chip/60",
          node.kind && "bg-sap-chip/40 font-medium",
        )}
        style={{ gridTemplateColumns: templateColumns(columns) }}
      >
        {columns.map((column, columnIndex) => {
          const value = node.columns[column.name] ?? node.rollup?.[column.name];
          const cellLinks =
            links?.[node.levelName]?.cell?.[column.name]?.({
              result,
              node,
              levelName: node.levelName,
              input: linkContext,
              ancestors,
              column,
              value,
            }) ?? [];
          return (
            <div
              key={column.name}
              className={cn(
                "min-w-0 px-[10px] py-[7px]",
                column.kind === "number" && "text-right mono",
                column.strong && "font-semibold",
              )}
              style={{
                paddingLeft:
                  columnIndex === 0 ? `${10 + depth * 18}px` : undefined,
              }}
            >
              {renderValue(value, column, cellLinks, rowLinks)}
            </div>
          );
        })}
      </div>
      {Object.entries(node.children ?? {}).map(([childLevelName, child]) => {
        const childNodes = Array.isArray(child) ? child : child ? [child] : [];
        return (
          <ReportGrid
            key={childLevelName}
            result={result}
            nodes={childNodes}
            levelName={childLevelName}
            levelColumns={levelColumns}
            footerRows={node.childFooterRows?.[childLevelName]}
            links={links}
            linkContext={linkContext}
            ancestors={[...ancestors, node]}
          />
        );
      })}
    </div>
  );
}

function ReportFooter({
  result,
  footerRow,
  columns,
  links,
  linkContext,
}: {
  result: GridReportResultData;
  footerRow: GridFooterRow;
  columns: GridColumn[];
  links?: (context: ReportGridFooterLinkContext) => ReportGridLink[];
  linkContext?: unknown;
}) {
  const footerLinks =
    links?.({
      result,
      footerRow,
      input: linkContext,
    }) ?? [];

  return (
    <div
      className="grid border-b border-sap-border bg-sap-chip font-semibold"
      style={{ gridTemplateColumns: templateColumns(columns) }}
    >
      {columns.map((column, index) => (
        <div
          key={column.name}
          className={cn(
            "px-[10px] py-[7px]",
            column.kind === "number" && "text-right mono",
          )}
        >
          {renderValue(
            index === 0 && footerRow.columns[column.name] === undefined
              ? footerRow.label
              : footerRow.columns[column.name],
            column,
            footerLinks,
            [],
          )}
        </div>
      ))}
    </div>
  );
}

function visibleColumns(columns: GridColumn[]): GridColumn[] {
  return columns.filter((column) => column.visuallyHidden !== true);
}

function templateColumns(columns: readonly GridColumn[]): string {
  if (columns.length === 0) return "1fr";
  return columns.map((column) => trackForColumn(column)).join(" ");
}

function trackForColumn(column: GridColumn): string {
  if (column.width) return `${column.width}ch`;
  const min = column.minWidth ?? (column.kind === "number" ? 10 : 12);
  const max = column.maxWidth ? `${column.maxWidth}ch` : "1fr";
  return `minmax(${min}ch, ${max})`;
}

function renderValue(
  value: unknown,
  column: GridColumn,
  cellLinks: ReportGridLink[],
  rowLinks: ReportGridLink[],
): ReactNode {
  const text = formatValue(value, column);
  const link = cellLinks[0] ?? rowLinks[0];
  if (!link) return text;
  return (
    <a
      href={link.href}
      target={link.target}
      className="text-sap-brand hover:underline"
      rel={link.target === "_blank" ? "noreferrer" : undefined}
    >
      {text}
    </a>
  );
}

function formatValue(value: unknown, column: GridColumn): string {
  if (value === null || value === undefined || value === "") return "";
  if (column.kind === "number") {
    const number = Number(value);
    if (Number.isFinite(number)) {
      if (number === 0 && column.zeroDisplay === "blank") return "";
      if (number === 0 && column.zeroDisplay === "dot") return ".";
      if (column.displayFormat === "currency") {
        return new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(number);
      }
      if (column.displayFormat === "percentage") {
        return new Intl.NumberFormat(undefined, {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(number);
      }
      return new Intl.NumberFormat().format(number);
    }
  }
  return String(value);
}
