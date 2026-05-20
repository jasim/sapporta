import { ReactNode } from "react";

/**
 * Framing primitive for the app sidebar. Fixed 220px width, hairline border
 * on the right, sits on `sidebar` background. Provides a header slot (brand
 * row) and a scrollable body, plus an optional footer slot (typically the
 * command-menu kbd strip).
 */
export function SidebarShell({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <aside className="w-[220px] shrink-0 border-r border-sap-border-soft bg-sap-sidebar text-sap-fg flex flex-col h-full px-3 py-[18px]">
      <div className="h-[28px] mb-6 px-[2px] flex items-center gap-[10px]">
        {header}
      </div>
      <nav className="flex-1 overflow-y-auto">{children}</nav>
      {footer && (
        <div className="border-t border-sap-border-soft mt-4 pt-3 px-[2px]">
          {footer}
        </div>
      )}
    </aside>
  );
}
