import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { BootLoader } from "@/app/boot/BootLoader";
import { HomeRedirect } from "@/app/boot/HomeRedirect";
import { NotFoundView } from "@/app/boot/NotFoundView";
import { setNavigate } from "@/app/router/router-bridge";
import { AppShell } from "@/shell/components/AppShell";
import { RecordDrawer } from "@/table/drawer/RecordDrawer";
import { TableRoute } from "@/table/route/TableRoute";
import { ReportRoute } from "@/report/route/ReportRoute";

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
        <Route element={<AppShell drawerSlot={<RecordDrawer />} />}>
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

export { BootLoader } from "@/app/boot/BootLoader";
export { HomeRedirect } from "@/app/boot/HomeRedirect";
export { NotFoundView } from "@/app/boot/NotFoundView";
