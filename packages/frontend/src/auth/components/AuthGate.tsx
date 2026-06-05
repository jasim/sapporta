import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/auth/state/auth-store";

export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const load = useAuthStore((s) => s.load);

  useEffect(() => {
    if (status === "idle") void load();
  }, [load, status]);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (status === "unverified") {
    return <Navigate to="/verify-email" replace />;
  }

  if (status === "workspace_required") {
    return <Navigate to="/signup" replace />;
  }

  if (status === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg text-sap-negative">
        Could not load your session.
      </div>
    );
  }

  return <>{children}</>;
}

export function PublicOnlyGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const bootstrapStatus = useAuthStore((s) => s.bootstrapStatus);
  const loadBootstrapStatus = useAuthStore((s) => s.loadBootstrapStatus);

  useEffect(() => {
    if (!bootstrapStatus) void loadBootstrapStatus();
  }, [bootstrapStatus, loadBootstrapStatus]);

  if (status === "authenticated") return <Navigate to="/" replace />;
  if (location.pathname === "/login" && !bootstrapStatus) {
    return (
      <div className="flex h-screen items-center justify-center bg-sap-bg">
        <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
      </div>
    );
  }
  if (location.pathname === "/login" && bootstrapStatus?.isEmpty === true) {
    return <Navigate to="/signup" replace />;
  }
  return <>{children}</>;
}
