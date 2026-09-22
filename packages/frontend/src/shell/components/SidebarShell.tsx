import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

/**
 * The visual contents of a sidebar: application identity, navigation, and an
 * optional account footer. It makes no responsive decisions. `SidebarRegion`
 * can place the same content beside a desktop page or inside a compact drawer.
 *
 * Pass `rail` from `useSidebar().rail`. While it is true, the sidebar fills the
 * collapsed rail instead of its own width; the header, navigation, and footer
 * passed in decide which of their parts to show there. The header starts where
 * the navigation does, so a control placed first in it lines up with the
 * navigation icons below.
 *
 * Pass `onNavigate` when choosing a destination should put the sidebar away:
 * `closeTemporary` from `useSidebar()` dismisses the compact drawer and the
 * sidebar that hovering opened over the page, and does nothing while the
 * sidebar is expanded beside the page.
 */
export function SidebarShell({
  header,
  footer,
  children,
  className,
  rail = false,
  onNavigate,
}: {
  header: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col border-r border-sap-border-soft bg-sap-sidebar px-3 py-3 text-sap-fg",
        className,
        rail && "w-full",
      )}
    >
      <div className="mb-3 flex min-h-14 items-center gap-3 rounded-lg px-0.5">
        {header}
      </div>
      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-0.5 pb-2"
        onClick={onNavigate}
      >
        {children}
      </nav>
      {footer && (
        <div className="mt-3 border-t border-sap-border-soft px-0.5 pt-3">
          {footer}
        </div>
      )}
    </aside>
  );
}
