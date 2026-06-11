/**
 * Route component for /p/:projectId/tables/:tableName
 *
 * The route owns table-grid shell effects and delegates the table surface to
 * the table page.
 */

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { TablePage } from "@/table/page/TablePage";

export function TableRoute() {
  const { tableName } = useParams<{ tableName: string }>();
  const { loaded, tables } = useSchemaStore();
  const tableSchema = tables.find((t) => t.name === tableName);

  useEffect(() => {
    if (!tableName || !tableSchema) return;
    useSchemaStore.getState().setActiveTable(tableName);
  }, [tableName, tableSchema]);

  if (!loaded) return null;
  if (!tableName || !tableSchema) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Table not found
      </div>
    );
  }

  return <TablePage key={tableName} tableName={tableName} />;
}
