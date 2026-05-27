import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import {
  AppShell,
  BootLoader,
  NotFoundView,
  setNavigate,
} from "@sapporta/frontend/app";
import { Sidebar } from "./Sidebar";
import { Welcome } from "./Welcome";

// Keep table/report code out of the startup chunk until a matching route opens.
const TableRoute = lazy(() =>
  import("@sapporta/frontend/routes/table").then((m) => ({
    default: m.TableRoute,
  })),
);
const NewRecordRoute = lazy(() =>
  import("@sapporta/frontend/routes/new-record").then((m) => ({
    default: m.NewRecordRoute,
  })),
);
const ReportRoute = lazy(() =>
  import("@sapporta/frontend/routes/report").then((m) => ({
    default: m.ReportRoute,
  })),
);

function RouteFallback() {
  // Local fallback keeps lazy route loading independent of extra UI imports.
  return (
    <div className="p-[18px] text-sap-data text-sap-muted">Loading...</div>
  );
}

export function App() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <BootLoader>
      <Routes>
        <Route element={<AppShell sidebarContent={<Sidebar />} />}>
          {/* Swap to `<HomeRedirect />` from @sapporta/frontend once you want `/`
              to jump to the first table instead of the Welcome view. */}
          <Route index element={<Navigate to="/welcome" replace />} />
          <Route path="welcome" element={<Welcome />} />
          <Route
            path="tables/:tableName/new"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NewRecordRoute />
              </Suspense>
            }
          />
          <Route
            path="tables/:tableName"
            element={
              <Suspense fallback={<RouteFallback />}>
                <TableRoute />
              </Suspense>
            }
          />
          <Route
            path="reports/:reportName"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ReportRoute />
              </Suspense>
            }
          />
          {/* Add custom view routes here, e.g.:
              <Route path="views/imports" element={<Imports />} /> */}
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </BootLoader>
  );
}
