import type { ReactElement, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@sapporta/ui";
import type { TGridSourceStatus } from "./tgrid-source-status";

// Visual shell for table-like pages.
// It knows how loading, page-level errors, save-error banners, the grid, and
// pagination are arranged, but it does not know where any of that state comes
// from. Pass plain React nodes to keep the layout reusable in custom views.
export type TableGridSurfaceProps = {
  tableLabel: string;
  loadState: TGridSourceStatus;
  errorMessage?: string | null;
  errorBanner?: string | null;
  onDismissErrorBanner?: () => void;
  grid: ReactNode;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  className?: string;
};

// Render the standard table page chrome around caller-supplied controls.
// Use this when you want Sapporta's table layout but need to choose your own
// toolbar, pagination, filters, or grid content.
export function TableGridSurface({
  tableLabel,
  loadState,
  errorMessage,
  errorBanner,
  onDismissErrorBanner,
  grid,
  toolbar,
  pagination,
  className,
}: TableGridSurfaceProps): ReactElement {
  const showSpinner =
    loadState.status === "loading" && loadState.totalCount === 0;
  const visibleError =
    loadState.status === "error"
      ? (errorMessage ?? "Could not load rows.")
      : null;

  return (
    <div className={cn("flex h-full flex-col bg-sap-surface", className)}>
      {toolbar}

      {errorBanner && (
        <div
          role="alert"
          className="flex items-start gap-3 border-b border-sap-negative/30 bg-sap-negative/10 px-4 py-2 text-sm text-sap-negative"
        >
          <pre className="flex-1 whitespace-pre-wrap font-sans">
            {errorBanner}
          </pre>
          <button
            type="button"
            onClick={onDismissErrorBanner}
            aria-label="Dismiss error"
            className="opacity-70 hover:opacity-100"
          >
            x
          </button>
        </div>
      )}

      {showSpinner && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-sap-muted" />
        </div>
      )}

      {visibleError && (
        <div className="flex-1 flex items-center justify-center text-sap-negative px-6 text-center">
          {`Could not load ${tableLabel}: ${visibleError}`}
        </div>
      )}

      {!showSpinner && !visibleError && (
        <div className="flex-1 overflow-auto px-5 pb-7">
          <div className="bg-sap-surface">{grid}</div>
        </div>
      )}

      {pagination}
    </div>
  );
}
