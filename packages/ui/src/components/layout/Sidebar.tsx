import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Database, FileText } from "lucide-react";
import { useSchemaStore } from "../../stores/schema-store";
import { cn } from "@/lib/utils";
import { Kbd } from "../ui/kbd";
import { SidebarShell } from "./SidebarShell";

interface AppSidebarProps {
  /** Rendered ABOVE the Tables/Reports sections. Intended for app-chrome
   *  the host wants to inject (e.g. custom view links). */
  sidebarContent?: ReactNode;
}

/** 17px stroked bracket + S-curve mark. Inherits currentColor so it picks
 *  up the wordmark's text color without any per-theme tuning. */
export function SapportaMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M6.5 4.5 H4 V19.5 H6.5"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M17.5 4.5 H20 V19.5 H17.5"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M14.5 8 C 14.5 6.5, 13 6, 12 6 C 10 6, 9 7.5, 9 9 C 9 10.5, 10.5 11, 12 11 C 13.5 11, 15 11.5, 15 13.5 C 15 15.5, 13.5 17, 11.5 17 C 10 17, 8.5 16.4, 8.5 15"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarHeader() {
  const slug = useSchemaStore((s) => s.slug);
  return (
    <span className="text-sap-mark font-semibold tracking-sap-display truncate">
      {slug ?? ""}
    </span>
  );
}

/** Section label for the sidebar (`VIEWS` / `TABLES` / `REPORTS`). Exported
 *  so host projects injecting content via `sidebarContent` can render a
 *  matching label above their own nav items. */
export function SidebarSectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-[14px] pt-[14px] pb-[6px] flex items-center justify-between text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Sidebar navigation row. Active state: 2px brand left stripe, active-nav
 *  background tint, and the icon is replaced by a ▸ caret. Deliberately
 *  flat — the stripe reads as a cursor parked on a row.
 *
 *  Exported so host projects can render Views-section entries that match
 *  the library's Tables/Reports items pixel-for-pixel. */
export function SidebarNavItem({
  to,
  icon,
  label,
  active,
  count,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 h-sap-header pl-[12px] pr-[10px] border-l-2 text-sap-body",
        active
          ? "border-l-sap-brand bg-sap-active-nav text-sap-fg font-medium"
          : "border-l-transparent text-sap-muted hover:bg-sap-row-hover",
      )}
    >
      <span
        className={cn(
          "w-[14px] h-[14px] inline-flex items-center justify-center shrink-0",
          active ? "text-sap-brand mono text-sap-data" : "text-sap-subtle",
        )}
      >
        {active ? "▸" : icon}
      </span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {count != null && (
        <span className="text-sap-label font-medium text-sap-subtle bg-sap-nav-count rounded-[4px] px-[5px] py-[1px]">
          {count}
        </span>
      )}
    </Link>
  );
}

export function AppSidebar({ sidebarContent }: AppSidebarProps) {
  const { tables, reports, loading } = useSchemaStore();
  const location = useLocation();

  const footer = (
    <div className="flex items-center gap-2">
      <Kbd>⌘K</Kbd>
      <span className="text-sap-menu text-sap-muted">Command menu</span>
    </div>
  );

  return (
    <SidebarShell header={<SidebarHeader />} footer={footer}>
      {sidebarContent}

      <SidebarSectionLabel>Tables</SidebarSectionLabel>

      {loading && (
        <div className="px-[14px] py-3 text-sap-data text-sap-muted">Loading…</div>
      )}

      {tables.map((table) => {
        const tablePath = `/tables/${table.name}`;
        const active = location.pathname.startsWith(tablePath);
        return (
          <SidebarNavItem
            key={table.name}
            to={tablePath}
            icon={<Database className="h-[12px] w-[12px]" strokeWidth={1.5} />}
            label={table.label}
            active={active}
          />
        );
      })}

      {reports.length > 0 && (
        <>
          <SidebarSectionLabel>Reports</SidebarSectionLabel>
          {reports.map((report) => {
            const reportPath = `/reports/${report.name}`;
            const active = location.pathname.startsWith(reportPath);
            return (
              <SidebarNavItem
                key={report.name}
                to={reportPath}
                icon={
                  <FileText className="h-[12px] w-[12px]" strokeWidth={1.5} />
                }
                label={report.label}
                active={active}
              />
            );
          })}
        </>
      )}
    </SidebarShell>
  );
}
