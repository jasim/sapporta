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
    <aside className="w-[220px] shrink-0 border-r border-sidebar-border bg-sap-sidebar text-sidebar-foreground flex flex-col h-full">
      <div className="px-[14px] pt-[14px] pb-[10px] flex items-center gap-2">
        {header}
      </div>
      <nav className="flex-1 overflow-y-auto">{children}</nav>
      {footer && (
        <div className="border-t border-sap-border px-[14px] py-[10px]">
          {footer}
        </div>
      )}
    </aside>
  );
}
