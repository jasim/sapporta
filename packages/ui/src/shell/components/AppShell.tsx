import type { ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";

interface AppShellProps {
  sidebarContent?: ReactNode;
  drawerSlot?: ReactNode;
}

export function AppShell({ sidebarContent, drawerSlot }: AppShellProps) {
  const { loaded, error } = useSchemaStore();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex flex-1 min-h-0">
        <AppSidebar sidebarContent={sidebarContent} />
        <main className="flex-1 flex flex-col min-w-0 bg-sap-surface overflow-y-auto">
          {error && (
            <div className="p-8 text-destructive">
              Failed to load schema: {error}
            </div>
          )}
          {!loaded && !error && (
            <div className="flex items-center justify-center h-full text-sap-muted">
              Loading…
            </div>
          )}
          {loaded && <Outlet />}
        </main>
      </div>
      <StatusBar />
      {drawerSlot}
    </div>
  );
}
