import { Navigate } from "react-router-dom";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";

export function HomeRedirect() {
  const { loaded, tables } = useSchemaStore();

  if (!loaded) return null;

  if (tables.length > 0) {
    return <Navigate to={`/tables/${tables[0].name}`} replace />;
  }
  return (
    <div className="flex items-center justify-center h-full text-sap-muted">
      No tables are available yet.
    </div>
  );
}
