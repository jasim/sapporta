import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import {
  AppShell,
  NotFoundView,
  setNavigate,
} from "@sapporta/frontend/app";
import { BootLoader } from "@sapporta/frontend/app";
import {
  AuthGate,
  PublicOnlyGate,
  useAuthStore,
} from "@sapporta/frontend/auth/runtime";
import { Sidebar } from "./Sidebar";
import { Welcome } from "./Welcome";

const LoginPage = lazy(() =>
  import("@sapporta/frontend/auth/pages").then((m) => ({
    default: m.LoginPage,
  })),
);
const SignupPage = lazy(() =>
  import("@sapporta/frontend/auth/pages").then((m) => ({
    default: m.SignupPage,
  })),
);
const VerifyEmailPage = lazy(() =>
  import("@sapporta/frontend/auth/pages").then((m) => ({
    default: m.VerifyEmailPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import("@sapporta/frontend/auth/pages").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("@sapporta/frontend/auth/pages").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);

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
  const isOwner = useAuthStore((s) => s.context?.isOwner ?? false);
  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  return (
    <Routes>
      <Route
        path="login"
        element={
          <PublicOnlyGate>
            <Suspense fallback={<RouteFallback />}>
              <LoginPage />
            </Suspense>
          </PublicOnlyGate>
        }
      />
      <Route
        path="signup"
        element={
          <PublicOnlyGate>
            <Suspense fallback={<RouteFallback />}>
              <SignupPage />
            </Suspense>
          </PublicOnlyGate>
        }
      />
      <Route
        path="verify-email"
        element={
          <Suspense fallback={<RouteFallback />}>
            <VerifyEmailPage />
          </Suspense>
        }
      />
      <Route
        path="forgot-password"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ForgotPasswordPage />
          </Suspense>
        }
      />
      <Route
        path="reset-password"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ResetPasswordPage />
          </Suspense>
        }
      />

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
  );
}
