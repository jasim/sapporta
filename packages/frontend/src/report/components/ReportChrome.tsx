import type { ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { TopBar } from "@/shell/components/TopBar";
import { cn } from "@sapporta/ui";

export interface ReportScreenFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function ReportScreenFrame({
  title,
  subtitle,
  actions,
  children,
}: ReportScreenFrameProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        section="Reports"
        title={title}
        subtitle={subtitle}
        actions={actions}
      />
      {children}
    </div>
  );
}

export interface ReportToolbarProps {
  children?: ReactNode;
  actions?: ReactNode;
}

export function ReportToolbar({ children, actions }: ReportToolbarProps) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 border-b border-sap-border bg-sap-chip px-[14px] py-[8px]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
        {children}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export interface ReportRunButtonProps {
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function ReportRunButton({
  loading = false,
  disabled = false,
  onClick,
}: ReportRunButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-sap-ctl items-center gap-[6px] rounded-[5px] bg-primary px-[10px] text-sap-emph font-medium text-primary-foreground hover:bg-primary/90",
        "disabled:opacity-60",
      )}
    >
      {loading ? (
        <Loader2 className="h-[12px] w-[12px] animate-spin" />
      ) : (
        <Play className="h-[12px] w-[12px]" />
      )}
      Run report
    </button>
  );
}

export function ReportError({ error }: { error: Error | string }) {
  return (
    <div className="shrink-0 border-b border-sap-border bg-sap-negative/10 px-[14px] py-[6px] text-sap-data text-sap-negative">
      {error instanceof Error ? error.message : error}
    </div>
  );
}
