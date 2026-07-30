import type { ButtonHTMLAttributes } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { useSidebar } from "../sidebar-controller";

export type SidebarToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-controls" | "aria-expanded" | "onClick" | "title"
>;

/**
 * Uses the control that fits the current screen: it changes the persisted
 * desktop width preference, or opens the temporary compact drawer. `AppShell`
 * renders this by default, so a page only needs its own toggle when it replaces
 * the shell control deliberately.
 */
export function SidebarToggle({ className, ...props }: SidebarToggleProps) {
  const sidebar = useSidebar();

  const expanded = sidebar.isDesktop
    ? sidebar.desktopExpanded
    : sidebar.drawerOpen;
  const label = sidebar.isDesktop
    ? expanded
      ? "Collapse sidebar"
      : "Expand sidebar"
    : expanded
      ? "Close sidebar"
      : "Open sidebar";
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;

  return (
    <button
      {...props}
      type="button"
      aria-controls={sidebar.sidebarId}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-md text-sap-muted transition-colors hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={
        sidebar.isDesktop
          ? sidebar.toggleDesktop
          : sidebar.drawerOpen
            ? sidebar.closeDrawer
            : sidebar.openDrawer
      }
    >
      <Icon className="size-[18px]" strokeWidth={1.7} />
    </button>
  );
}
