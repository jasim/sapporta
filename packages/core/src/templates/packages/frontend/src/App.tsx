import { useEffect } from "react";
import { Route, Navigate, Routes, useNavigate } from "react-router-dom";
import {
  AccountProfilePage,
  AppShell,
  setNavigate,
} from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
import { AuthGate, useAuthStore } from "@sapporta/frontend/auth/runtime";
import {
  sapportaNotFoundRoute,
  sapportaProtectedRoutes,
  sapportaPublicRoutes,
} from "./SapportaRoutes";
import { Sidebar } from "./Sidebar";
import { Welcome } from "./Welcome";

// This file is project-owned; scaffold refresh skips it so custom routes stay.
export function App() {
  const navigate = useNavigate();
  const isOwner = useAuthStore((s) => s.context?.isOwner ?? false);
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <Routes>
      {sapportaPublicRoutes}

      <Route
        element={
          <AuthGate>
            <BootLoader>
              <AppShell
                sidebarContent={<Sidebar />}
                showFrameworkNavigation={isOwner}
              />
            </BootLoader>
          </AuthGate>
        }
      >
        {/* Swap to `<HomeRedirect />` from @sapporta/frontend once you want `/`
            to jump to the first table instead of the Welcome view. */}
        <Route index element={<Navigate to="/welcome" replace />} />
        <Route path="account/profile" element={<AccountProfilePage />} />
        <Route path="welcome" element={<Welcome />} />

        {/* Add custom view routes here, e.g.:
            <Route path="views/imports" element={<Imports />} /> */}
        {sapportaProtectedRoutes}
        {sapportaNotFoundRoute}
      </Route>
    </Routes>
  );
}
