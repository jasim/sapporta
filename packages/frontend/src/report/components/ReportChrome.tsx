import type { ReactNode } from "react";
import { Globe, Loader2, Play } from "lucide-react";
import { formatTimeZoneOffsetLabel } from "@sapporta/shared/temporal";
import { appTimeZone } from "../../platform/app-time-zone";
import { PageHeader } from "../../shell/components/PageHeader";
import { PageFrame } from "../../shell/components/Page";
import { cn } from "@sapporta/ui/cn";

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
    <PageFrame>
      <PageHeader
        section="Reports"
        title={title}
        subtitle={subtitle}
        actions={actions}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </PageFrame>
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

/**
 * The calendar this report's days are counted in.
 *
 * A report whose numbers depend on a zone has to say which zone, or two people
 * comparing dashboards have no way to tell whether they disagree about the
 * data or about where the day starts. Static text, not a control: the zone
 * belongs to the workspace and is changed on the workspace settings screen.
 * Shown even when the zone is UTC, because "UTC" is a choice like any other
 * and its absence would read as "no zone involved".
 */
export function ReportTimeZoneNote() {
  const zone = appTimeZone();
  const offset = formatTimeZoneOffsetLabel(zone);
  return (
    <span
      className="flex min-w-0 items-center gap-[6px] text-sap-data text-sap-muted"
      title="Days are counted in the workspace's time zone."
    >
      <Globe className="h-[12px] w-[12px] shrink-0" strokeWidth={1.7} />
      <span className="truncate">{zone}</span>
      {offset !== zone && <span className="shrink-0">{offset}</span>}
    </span>
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
