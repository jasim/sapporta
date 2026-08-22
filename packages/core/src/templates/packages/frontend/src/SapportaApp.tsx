import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell, setNavigate } from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
import { AuthGate } from "@sapporta/frontend/auth/runtime";
import {
  appHomeRoute,
  appNavigation,
  appProtectedRoutes,
  appPublicHomeRoute,
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
 *
 * `/` opens the home page behind `AuthGate`, so a visitor without a session
 * goes to the sign-in page and returns to `/` afterwards. An app that opens `/`
 * to everyone fills `appPublicHomeRoute` in `App.tsx` instead.
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
        {appPublicHomeRoute}
        {appPublicRoutes}
        <Route element={<AuthGate />}>
          {appPublicHomeRoute ? null : appHomeRoute}
          {appProtectedRoutes}
          {sapportaProtectedRoutes}
        </Route>
        {sapportaNotFoundRoute}
      </Route>
    </Routes>
  );
}
