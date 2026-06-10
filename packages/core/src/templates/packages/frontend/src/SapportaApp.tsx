import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell, setNavigate } from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
import { AuthGate, useAuthStore } from "@sapporta/frontend/auth/runtime";
import {
  appHomeRoute,
  appNavigation,
  appProtectedRoutes,
  appPublicRoutes,
} from "./App";
import {
  sapportaNotFoundRoute,
  sapportaProtectedRoutes,
  sapportaPublicRoutes,
} from "./SapportaRoutes";

export function SapportaApp() {
  const navigate = useNavigate();
  const isOwner = useAuthStore((s) => s.context?.isOwner ?? false);
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <Routes>
      {sapportaPublicRoutes}
      {appPublicRoutes}

      <Route
        element={
          <AuthGate>
            <BootLoader>
              <AppShell
                navigation={appNavigation}
                showFrameworkNavigation={isOwner}
              />
            </BootLoader>
          </AuthGate>
        }
      >
        {appHomeRoute}
        {appProtectedRoutes}
        {sapportaProtectedRoutes}
        {sapportaNotFoundRoute}
      </Route>
    </Routes>
  );
}
