import { lazy, Suspense, type ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";
import { useSidebar } from "../sidebar-controller";
import "./SidebarRegion.css";

// Only compact screens open the sidebar as a modal sheet, so its dialog
// implementation loads with the layout that uses it.
const SidebarDrawer = lazy(() =>
  import("./SidebarDrawer").then((m) => ({ default: m.SidebarDrawer })),
);

export interface SidebarRegionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Presents the same application navigation in two useful forms. On desktop,
 * the expanded sidebar takes its usual width. Collapsing it returns that width
 * to the page; a fine pointer can still reveal the sidebar temporarily from
 * the left edge without moving the content.
 *
 * On a compact screen, the sidebar opens as a modal `Sheet`. It traps focus
 * while open and closes through normal dialog dismissal or after navigation.
 */
export function SidebarRegion({ children, className }: SidebarRegionProps) {
  const sidebar = useSidebar();

  if (!sidebar.isDesktop) {
    return (
      <Suspense fallback={null}>
        <SidebarDrawer>{children}</SidebarDrawer>
      </Suspense>
    );
  }

  return (
    <div
      id={sidebar.sidebarId}
      data-sidebar-region
      data-sidebar-state={sidebar.desktopExpanded ? "expanded" : "collapsed"}
      className={cn(
        "relative h-full shrink-0",
        sidebar.desktopExpanded ? "w-[240px]" : "z-[var(--sap-z-popover)] w-0",
        className,
      )}
    >
      {!sidebar.desktopExpanded && (
        <div
          aria-hidden="true"
          data-sidebar-hover-edge
          className="absolute inset-y-0 left-0 z-[var(--sap-z-popover)] w-2"
        />
      )}

      <div
        data-sidebar-surface
        className={cn(
          "inset-y-0 left-0 h-full w-[240px]",
          sidebar.desktopExpanded && "static",
          !sidebar.desktopExpanded &&
            "absolute z-[var(--sap-z-popover)] shadow-lg",
        )}
      >
        {children}
      </div>
    </div>
  );
}
