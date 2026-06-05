import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Database, FileText } from "lucide-react";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { AuthAccountMenu } from "./AuthAccountMenu";
import { SidebarShell } from "./SidebarShell";

export interface AppSidebarProps {
  /** Rendered ABOVE the Tables/Reports sections. Intended for app-chrome
   *  the host wants to inject (e.g. custom view links). */
  sidebarContent?: ReactNode;
  showFrameworkNavigation?: boolean;
}

export function SapportaMark({ size = 17 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-[5px]"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background:
          "linear-gradient(135deg, var(--sap-fg) 0 58%, var(--sap-brand) 58% 100%)",
      }}
    />
  );
}

function SidebarHeader() {
  const name = useSchemaStore((s) => s.name);
  return (
    <>
      <SapportaMark size={18} />
      <span className="text-sap-body font-bold tracking-sap-display truncate">
        {name ?? ""}
      </span>
    </>
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
    <div className="mt-[18px] mb-[6px] px-[2px] flex items-center justify-between text-sap-label font-bold uppercase tracking-sap-section text-sap-subtle">
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Sidebar navigation row. Active state: rounded active-nav background and
 *  the icon is replaced by a ▸ caret.
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
      className={cx(
        "flex items-center gap-2 h-[28px] rounded-[6px] px-2 text-sap-body no-underline",
        active
          ? "bg-sap-active-nav text-sap-fg font-[650]"
          : "text-sap-soft hover:bg-sap-row-hover",
      )}
    >
      <span
        className={cx(
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

export function AppSidebar({
  sidebarContent,
  showFrameworkNavigation = true,
}: AppSidebarProps) {
  const { tables, reports, loading } = useSchemaStore();
  const location = useLocation();

  return (
    <SidebarShell header={<SidebarHeader />} footer={<DefaultSidebarFooter />}>
      {sidebarContent}

      {showFrameworkNavigation && (
        <>
          <SidebarSectionLabel>Tables</SidebarSectionLabel>

          {loading && (
            <div className="px-[14px] py-3 text-sap-data text-sap-muted">
              Loading…
            </div>
          )}

          {tables.map((table) => {
            const tablePath = `/tables/${table.name}`;
            const active = location.pathname.startsWith(tablePath);
            return (
              <SidebarNavItem
                key={table.name}
                to={tablePath}
                icon={
                  <Database className="h-[12px] w-[12px]" strokeWidth={1.5} />
                }
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
                      <FileText
                        className="h-[12px] w-[12px]"
                        strokeWidth={1.5}
                      />
                    }
                    label={report.label}
                    active={active}
                  />
                );
              })}
            </>
          )}
        </>
      )}
    </SidebarShell>
  );
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function SidebarKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mono text-sap-label font-normal rounded-[3px] px-[5px] py-[1px] inline-flex items-center justify-center border border-sap-border bg-sap-kbd text-sap-subtle">
      {children}
    </kbd>
  );
}

function DefaultSidebarFooter() {
  return (
    <div className="space-y-2">
      <AuthAccountMenu />
      <div className="flex items-center gap-2">
        <SidebarKbd>⌘K</SidebarKbd>
        <span className="text-sap-menu text-sap-muted">Command menu</span>
      </div>
    </div>
  );
}
