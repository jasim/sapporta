import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";

/**
 * The visual contents of a sidebar: application identity, navigation, and an
 * optional account footer. It makes no responsive decisions. `SidebarRegion`
 * can place the same content beside a desktop page or inside a compact drawer.
 *
 * Pass `onNavigate` when choosing a destination should dismiss the containing
 * drawer. Desktop navigation can use the same callback harmlessly.
 */
export function SidebarShell({
  header,
  footer,
  children,
  className,
  onNavigate,
}: {
  header: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-full w-[240px] shrink-0 flex-col border-r border-sap-border-soft bg-sap-sidebar px-3 py-3 text-sap-fg",
        className,
      )}
    >
      <div className="mb-3 flex min-h-14 items-center gap-3 rounded-lg px-2">
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
