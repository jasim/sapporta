import { useMemo } from "react";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  defineSchemaTGrid,
  type SchemaTableGridSource,
  type SchemaTableRootRowsOptions,
  type SchemaTableRowsByLevel,
} from "@/table/grid-adapter/schema-tgrid";
import type { TableGridRoute } from "./table-grid-url-state";
import { TableGridView } from "./TableGridView";
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
  className?: string;
  gridClassName?: string;
};

const schemaTableGridRootRows: SchemaTableRootRowsOptions = {
  urlSync: true,
};

export function SchemaTableGridView({
  source,
  route,
  registerAs,
  onNewRecord,
  viewRelatedRows,
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
        rootRows: schemaTableGridRootRows,
      }),
    [gridSource],
  );

  return (
    <TableGridView<SchemaTableRowsByLevel>
      definition={definition}
      table={source.table}
      route={route}
      registerAs={registerAs}
      onNewRecord={onNewRecord}
      viewRelatedRows={viewRelatedRows}
      className={className}
      gridClassName={gridClassName}
    />
  );
}
