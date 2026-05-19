import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { TableRoute } from "./routes/TableRoute";
import { ReportRoute } from "./routes/ReportRoute";
import { setNavigate } from "./stores/router-bridge";
import { useSchemaStore } from "./stores/schema-store";
import { loadSchema, loadReports, loadProjectInfo } from "./stores/dispatchers";

export function HomeRedirect() {
  const { loaded, tables, reports } = useSchemaStore();

  if (!loaded) return null;

  if (tables.length > 0) {
    return <Navigate to={`/tables/${tables[0].name}`} replace />;
  }
  if (reports.length > 0) {
    return <Navigate to={`/reports/${reports[0].name}`} replace />;
  }

  return (
    <div className="flex items-center justify-center h-full text-sap-muted">
      No tables or reports available
    </div>
  );
}

/**
 * Loads schema and reports on mount.
 * Gates children until schema is loaded.
 */
export function BootLoader({ children }: { children: React.ReactNode }) {
  const loaded = useSchemaStore((s) => s.loaded);
  const error = useSchemaStore((s) => s.error);

  useEffect(() => {
    if (!loaded && !error) {
      loadSchema();
      loadReports();
      loadProjectInfo();
    }
  }, [loaded, error]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-sap-bg">
        <div className="max-w-lg text-center space-y-4">
          <div className="text-lg font-medium text-sap-negative">Could not load schema</div>
          <p className="text-sm text-sap-muted">
            Fetched <code className="text-xs bg-sap-nested px-1 py-0.5 rounded mono">GET /api/meta/tables</code> and
            the server responded with an error.
          </p>
          <pre className="text-sm text-left bg-sap-nested rounded-md p-3 whitespace-pre-wrap break-words mono">{error}</pre>
          <button
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              useSchemaStore.getState().reset();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-sap-bg">
        <div className="text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-sap-muted mx-auto" />
          <p className="text-sm text-sap-muted">Loading schema</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function NotFoundView() {
  return (
    <div className="flex items-center justify-center h-full text-sap-muted">
      Page not found
    </div>
  );
}

/**
 * Single-project admin UI: boots schema on mount and renders the admin
 * interface (tables, reports).
 */
export function App() {
  const navigate = useNavigate();

  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <BootLoader>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="tables/:tableName" element={<TableRoute />} />
          <Route path="tables/:tableName/new" element={<TableRoute />} />
          <Route path="reports/:reportName" element={<ReportRoute />} />
        </Route>
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </BootLoader>
  );
}
