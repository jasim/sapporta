/**
 * Renders the standard table screen for the `tables/:tableName` route.
 * Pass `gridOptionsByTable` to tune individual tables.
 */

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { AppPage } from "../../shell/components/Page";
import { TablePage, type TablePageGridOptions } from "../page/TablePage";

export type TableGridOptionsByTable = Record<string, TablePageGridOptions>;

export type TableRouteProps = {
  gridOptionsByTable?: TableGridOptionsByTable;
};

export function TableRoute({ gridOptionsByTable }: TableRouteProps) {
  const { tableName } = useParams<{ tableName: string }>();
  const { loaded, tables } = useSchemaStore();
  const tableSchema = tables.find((t) => t.name === tableName);
  const gridOptions = tableName ? gridOptionsByTable?.[tableName] : undefined;

  useEffect(() => {
    if (!tableName || !tableSchema) return;
    useSchemaStore.getState().setActiveTable(tableName);
  }, [tableName, tableSchema]);

  if (!loaded) return null;
  if (!tableName || !tableSchema) {
    return (
      <AppPage
        title="Table not found"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        We could not find the schema for "{tableName}".
      </AppPage>
    );
  }

  return (
    <TablePage
      key={tableName}
      tableName={tableName}
      gridOptions={gridOptions}
    />
  );
}
