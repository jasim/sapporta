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

export interface SapportaAppProps {
  // Shows Sapporta's generated table navigation by default. Turn this off when
  // the app provides its own navigation surface for built-in table routes.
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
