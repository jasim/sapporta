import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { NewRecordPage } from "../form/NewRecordPage";

export function NewRecordRoute() {
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

  return <NewRecordPage key={`${tableName}:new`} tableSchema={tableSchema} />;
}
