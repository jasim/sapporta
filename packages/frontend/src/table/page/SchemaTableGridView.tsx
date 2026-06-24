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
  source: SchemaTableGridViewSource;
  route: TableGridRoute;
  registerAs?: string;
  onNewRecord?: () => void;
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
