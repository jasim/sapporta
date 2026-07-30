import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { AppPage } from "../../shell/components/Page";
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
      <AppPage
        title="Table not found"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        We could not find the schema for "{tableName}".
      </AppPage>
    );
  }

  return <NewRecordPage key={`${tableName}:new`} tableSchema={tableSchema} />;
}
