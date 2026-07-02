import { useEffect, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "../state/auth-store";

export function AuthGate({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const session = useAuthStore((s) => s.session);

  if (session.kind === "unknown" || session.kind === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }

  if (session.kind === "guest") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (session.kind === "unverified") {
    return <Navigate to="/verify-email" replace />;
  }

  if (session.kind === "workspaceRequired") {
    return <Navigate to="/signup" replace />;
  }

  if (session.kind === "failed") {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg text-sap-negative">
        Could not load your session.
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}

export function PublicOnlyGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useAuthStore((s) => s.session);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);
  const loadBootstrapStatus = useAuthStore((s) => s.loadBootstrapStatus);

  useEffect(() => {
    if (session.kind !== "authenticated" && !bootstrapStatus) {
      void loadBootstrapStatus();
    }
  }, [bootstrapStatus, loadBootstrapStatus, session.kind]);

  if (session.kind === "authenticated") return <Navigate to="/" replace />;
  if (location.pathname === "/login" && !bootstrapStatus) {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }
  if (
    location.pathname === "/login" &&
    bootstrapStatus?.shouldShowSignUp === true
  ) {
    return <Navigate to="/signup" replace />;
  }
  return <>{children}</>;
}
