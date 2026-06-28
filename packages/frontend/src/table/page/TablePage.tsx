import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { navigateToNewRecord } from "@/table/actions/record-actions";
import {
  SchemaTableGridView,
  type SchemaTableGridViewProps,
} from "./SchemaTableGridView";

export type TablePageGridOptions = Omit<
  // These values come from the current table route. Pass grid options for
  // behavior you want to tune, such as row loading or interaction behavior.
  SchemaTableGridViewProps,
  "source" | "route" | "registerAs" | "onNewRecord"
>;

export type TablePageProps = {
  tableName: string;
  gridOptions?: TablePageGridOptions;
};

// Standard `/tables/:tableName` page. Pass gridOptions to adjust the table
// view while keeping the usual URL, schema, and New record behavior.
export function TablePage({ tableName, gridOptions }: TablePageProps) {
  const tableSchema = useSchemaStore((s) =>
    s.tables.find((t) => t.name === tableName),
  );
  const tables = useSchemaStore((s) => s.tables);

  if (!tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        We could not find the schema for "{tableName}".
      </div>
    );
  }

  return (
    <TablePageWithSession
      tableName={tableName}
      tableSchema={tableSchema}
      tables={tables}
      gridOptions={gridOptions}
    />
  );
}

function TablePageWithSession({
  tableName,
  tableSchema,
  tables,
  gridOptions,
}: {
  tableName: string;
  tableSchema: TableSchema;
  tables: readonly TableSchema[];
  gridOptions?: TablePageGridOptions;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tablesByName = useMemo(
    () => Object.fromEntries(tables.map((table) => [table.name, table])),
    [tables],
  );
  const route = useMemo(
    () => ({
      path: `/tables/${tableName}`,
      searchParams,
      navigate,
    }),
    [navigate, searchParams, tableName],
  );

  return (
    <SchemaTableGridView
      {...gridOptions}
      source={{
        table: tableSchema,
        tablesByName,
      }}
      route={route}
      registerAs={tableName}
      onNewRecord={
        tableSchema.immutable
          ? undefined
          : () => navigateToNewRecord(tableSchema.name)
      }
      viewRelatedRows={gridOptions?.viewRelatedRows ?? true}
    />
  );
}
