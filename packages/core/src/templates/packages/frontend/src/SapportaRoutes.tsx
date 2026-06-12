import { lazy, Suspense } from "react";
import { Route } from "react-router-dom";
import { AccountProfilePage, NotFoundView } from "@sapporta/frontend/app";
import { PublicOnlyGate } from "@sapporta/frontend/auth/runtime";

// Load screens on demand so the app starts quickly.
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

function RouteFallback() {
  return (
    <div className="p-[18px] text-sap-data text-sap-muted">Loading...</div>
  );
}

export const sapportaPublicRoutes = (
  <>
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
  </>
);

export const sapportaProtectedRoutes = (
  <>
    <Route path="account/profile" element={<AccountProfilePage />} />
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
  </>
);

export const sapportaNotFoundRoute = (
  <Route path="*" element={<NotFoundView />} />
);
