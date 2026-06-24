import { useMemo } from "react";
import type { GridInteractionConfig } from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  defineSchemaTGrid,
  type SchemaTableRelatedRowsOptions,
  type SchemaTableGridSource,
  type SchemaTableRootRowsOptions,
  type SchemaTableRowsByLevel,
} from "@/table/grid-adapter/schema-tgrid";
import type { TableGridRoute } from "./table-grid-url-state";
import { TableGridView, type TableGridViewProps } from "./TableGridView";
import type { ViewRelatedRowsOption } from "./TGrid";

export type SchemaTableGridViewSource = {
  table: TableSchema;
  tablesByName: Record<string, TableSchema>;
};

export type SchemaTableGridViewProps = {
  /** Pass the table to show and any loaded schemas needed for expandable rows. */
  source: SchemaTableGridViewSource;
  /** Pass the current page path and router helpers so table controls update the URL. */
  route: TableGridRoute;
  /** Use a stable name, usually the table name, for this table page. */
  registerAs?: string;
  /** Provide this when the page should show a New record action. */
  onNewRecord?: () => void;
  /** Tune row expansion, row loading, interaction, controls, and styling. */
  viewRelatedRows?: ViewRelatedRowsOption;
  rootRows?: SchemaTableRootRowsOptions;
  relatedRows?: SchemaTableRelatedRowsOptions;
  interaction?: GridInteractionConfig;
  loadLookups?: boolean;
  toolbar?: TableGridViewProps<SchemaTableRowsByLevel>["toolbar"];
  pagination?: TableGridViewProps<SchemaTableRowsByLevel>["pagination"];
  className?: string;
  gridClassName?: string;
};

const schemaTableGridDefaultRootRows: SchemaTableRootRowsOptions = {
  urlSync: true,
};

export function SchemaTableGridView({
  source,
  route,
  registerAs,
  onNewRecord,
  viewRelatedRows,
  rootRows,
  relatedRows,
  interaction,
  loadLookups,
  toolbar,
  pagination,
  className,
  gridClassName,
}: SchemaTableGridViewProps) {
  const gridSource = useMemo<SchemaTableGridSource>(
    () => ({
      rootTableName: source.table.name,
      tablesByName: source.tablesByName,
    }),
    [source.table.name, source.tablesByName],
  );
  const definition = useMemo(
    () =>
      defineSchemaTGrid({
        source: gridSource,
        rootRows: {
          ...schemaTableGridDefaultRootRows,
          ...rootRows,
        },
        relatedRows,
        interaction,
      }),
    [gridSource, interaction, relatedRows, rootRows],
  );

  return (
    <TableGridView<SchemaTableRowsByLevel>
      definition={definition}
      table={source.table}
      route={route}
      registerAs={registerAs}
      loadLookups={loadLookups}
      onNewRecord={onNewRecord}
      viewRelatedRows={viewRelatedRows}
      toolbar={toolbar}
      pagination={pagination}
      className={className}
      gridClassName={gridClassName}
    />
  );
}
