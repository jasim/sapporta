import { ReactNode } from "react";

/**
 * Framing primitive for the app sidebar. Provides a project header, scrollable
 * navigation, and an optional account footer on the sidebar surface.
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
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-sap-border-soft bg-sap-sidebar px-3 py-3 text-sap-fg">
      <div className="mb-3 flex min-h-14 items-center gap-3 rounded-lg px-2">
        {header}
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-0.5 pb-2">
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
