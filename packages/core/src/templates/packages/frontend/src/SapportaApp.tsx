import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell, setNavigate } from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
import { AuthGate } from "@sapporta/frontend/auth/runtime";
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

/**
 * This component joins the application UI with Sapporta's supplied UI.
 * `BootLoader` loads the session and table metadata. `AppShell` renders the
 * layout and table navigation. The route tree combines `App.tsx` with the
 * account and table pages in `SapportaRoutes.tsx`.
 */
export interface SapportaAppProps {
  // Show table links generated from the loaded schema.
  showFrameworkNavigation?: boolean;
}

export function SapportaApp({
  showFrameworkNavigation = true,
}: SapportaAppProps) {
  const navigate = useNavigate();

  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <Routes>
      {sapportaPublicRoutes}

      <Route
        element={
          <BootLoader>
            <AppShell
              navigation={appNavigation}
              showFrameworkNavigation={showFrameworkNavigation}
            />
          </BootLoader>
        }
      >
        {appHomeRoute}
        {appPublicRoutes}
        <Route element={<AuthGate />}>
          {appProtectedRoutes}
          {sapportaProtectedRoutes}
        </Route>
        {sapportaNotFoundRoute}
      </Route>
    </Routes>
  );
}
