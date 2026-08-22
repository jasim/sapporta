import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@sapporta/ui/sheet";
import { useSidebar } from "../sidebar-controller";

/**
 * The compact-screen form of the sidebar. It opens as a modal sheet, traps
 * focus while open, and closes through normal dialog dismissal or after
 * navigation. Desktop layouts never render it.
 */
export function SidebarDrawer({ children }: { children: ReactNode }) {
  const sidebar = useSidebar();

  return (
    <Sheet
      open={sidebar.drawerOpen}
      onOpenChange={(open) => {
        if (!open) sidebar.closeDrawer();
      }}
    >
      <SheetContent
        id={sidebar.sidebarId}
        side="left"
        data-sidebar-drawer
        className="w-[240px] max-w-none border-sap-border-soft bg-sap-sidebar p-0 text-sap-fg [&>button]:right-2 [&>button]:top-2"
      >
        <SheetTitle className="sr-only">Application navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
