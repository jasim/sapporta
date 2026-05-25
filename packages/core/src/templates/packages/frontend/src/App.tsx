import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import {
  AppShell,
  BootLoader,
  NotFoundView,
  TableRoute,
  NewRecordRoute,
  ReportRoute,
  setNavigate,
} from "@sapporta/frontend";
import { Sidebar } from "./Sidebar";
import { Welcome } from "./Welcome";

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
          <Route path="tables/:tableName/new" element={<NewRecordRoute />} />
          <Route path="tables/:tableName" element={<TableRoute />} />
          <Route path="reports/:reportName" element={<ReportRoute />} />
          {/* Add custom view routes here, e.g.:
              <Route path="views/imports" element={<Imports />} /> */}
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </BootLoader>
  );
}
