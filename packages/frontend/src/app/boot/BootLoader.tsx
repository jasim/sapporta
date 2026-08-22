import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { loadAdminMetadata, prefetchAdminMetadata } from "../actions/boot";
import { useAuthStore } from "../../auth/state/auth-store";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";

/**
 * Loads app metadata and restores the browser session before rendering shell
 * routes. Route guards decide what each settled session may see.
 */
export function BootLoader({ children }: { children: ReactNode }) {
  const loaded = useSchemaStore((s) => s.loaded);
  const error = useSchemaStore((s) => s.error);
  const session = useAuthStore((s) => s.session);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    if (session.kind === "authenticated" && !loaded && !error) {
      loadAdminMetadata();
    }
  }, [loaded, error, session.kind]);

  useEffect(() => {
    if (session.kind === "unknown") {
      prefetchAdminMetadata();
      void restoreSession();
    }
  }, [restoreSession, session.kind]);

  if (session.kind === "authenticated" && error) {
    return (
      <div className="flex items-center justify-center h-screen bg-sap-bg">
        <div className="max-w-lg text-center space-y-4">
          <div className="text-lg font-medium text-sap-negative">
            Could not load the app schema
          </div>
          <p className="text-sm text-sap-muted">
            We asked the server for{" "}
            <code className="text-xs bg-sap-nested px-1 py-0.5 rounded mono">
              GET /api/meta/tables
            </code>{" "}
            and it returned an error.
          </p>
          <pre className="text-sm text-left bg-sap-nested rounded-md p-3 whitespace-pre-wrap break-words mono">
            {error}
          </pre>
          <button
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              useSchemaStore.getState().reset();
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (
    session.kind === "unknown" ||
    session.kind === "loading" ||
    (session.kind === "authenticated" && !loaded)
  ) {
    return (
      <div className="flex items-center justify-center h-screen bg-sap-bg">
        <div className="text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-sap-muted mx-auto" />
          <p className="text-sm text-sap-muted">Loading your app</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
