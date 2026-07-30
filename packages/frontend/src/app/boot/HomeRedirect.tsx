import { Navigate } from "react-router-dom";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { AppPage } from "../../shell/components/Page";

export function HomeRedirect() {
  const { loaded, tables } = useSchemaStore();

  if (!loaded) return null;

  if (tables.length > 0) {
    return <Navigate to={`/tables/${tables[0].name}`} replace />;
  }
  return (
    <AppPage
      title="No tables available"
      bodyClassName="flex items-center justify-center text-sap-muted"
    >
      No tables are available yet.
    </AppPage>
  );
}
