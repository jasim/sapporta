import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { loadAdminMetadata } from "@/app/actions/boot";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";

/**
 * Loads schema and reports on mount.
 * Gates children until schema is loaded.
 */
export function BootLoader({ children }: { children: ReactNode }) {
  const loaded = useSchemaStore((s) => s.loaded);
  const error = useSchemaStore((s) => s.error);

  useEffect(() => {
    if (!loaded && !error) {
      loadAdminMetadata();
    }
  }, [loaded, error]);

  if (error) {
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

  if (!loaded) {
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
