import { forwardRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import type { TablePageMode } from "./table-page-mode";
import type { TGridSourceStatus } from "../tgrid/tgrid-source-status";

// Visual shell for table-like pages.
// It knows how loading, page-level errors, save-error banners, content, and the
// footer are arranged, but it does not know where any of that state comes from.
export type TableGridSurfaceProps = {
  mode: TablePageMode;
  tableLabel: string;
  loadState: TGridSourceStatus;
  errorMessage?: string | null;
  errorBanner?: string | null;
  onDismissErrorBanner?: () => void;
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export const TableGridSurface = forwardRef<
  HTMLDivElement,
  TableGridSurfaceProps
>(function TableGridSurface(
  {
    mode,
    tableLabel,
    loadState,
    errorMessage,
    errorBanner,
    onDismissErrorBanner,
    header,
    children,
    footer,
    className,
  },
  ref,
) {
  const showSpinner =
    loadState.status === "initialLoading" && loadState.totalCount === 0;
  const showRefreshing = loadState.status === "refreshing";
  const visibleError =
    loadState.status === "initialError"
      ? (errorMessage ?? "Could not load rows.")
      : null;

  return (
    <div
      ref={ref}
      data-table-page-mode={mode}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-sap-surface",
        className,
      )}
    >
      {header}

      {showRefreshing && (
        <div
          role="status"
          aria-live="polite"
          className="h-[2px] shrink-0 overflow-hidden bg-sap-border-soft"
        >
          <div className="h-full w-1/3 animate-pulse bg-sap-loading-indicator-bar" />
        </div>
      )}

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
        <div
          className={cn(
            "flex-1 overflow-auto",
            mode === "narrowCards" ? "px-2 pb-3" : "px-5 pb-7",
          )}
        >
          <div className="bg-sap-surface">{children}</div>
        </div>
      )}

      {footer}
    </div>
  );
});
