import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import { DesktopSidebar, MobileBottomNav, NavigationRail } from "./Sidebar";
import { Toaster } from "sonner";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import type { TableSchema } from "@sapporta/shared/contracts";
import { Database } from "lucide-react";
import type { Navigation, NavigationSection } from "../navigation";

export interface AppShellProps {
  navigation?: Navigation;
  showFrameworkNavigation?: boolean;
}

export function AppShell({
  navigation = [],
  showFrameworkNavigation = true,
}: AppShellProps) {
  const { error, tables } = useSchemaStore();
  const shellNavigation = useMemo(() => {
    const frameworkNavigation = showFrameworkNavigation
      ? frameworkNavigationSections({ tables })
      : [];
    return [...navigation, ...frameworkNavigation];
  }, [navigation, showFrameworkNavigation, tables]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Toaster
        position="top-center"
        richColors
        toastOptions={{
          classNames: {
            toast: "text-[17px]",
            title: "font-semibold",
          },
        }}
      />
      <div className="flex flex-1 min-h-0">
        <div className="hidden lg:block h-full">
          <DesktopSidebar navigation={shellNavigation} />
        </div>
        <NavigationRail navigation={shellNavigation} />
        <main className="flex-1 flex flex-col min-w-0 bg-sap-surface overflow-y-auto pb-[56px] md:pb-0">
          {error && (
            <div className="p-8 text-destructive">
              Could not load the app schema: {error}
            </div>
          )}
          {!error && <Outlet />}
        </main>
        <MobileBottomNav
          navigation={navigation}
          pickerNavigation={shellNavigation}
        />
      </div>
    </div>
  );
}

function frameworkNavigationSections({
  tables,
}: {
  tables: readonly TableSchema[];
}): Navigation {
  const sections: NavigationSection[] = [];

  if (tables.length > 0) {
    sections.push({
      label: "Tables",
      items: tables.map((table) => ({
        label: table.label,
        to: `/tables/${table.name}`,
        icon: Database,
      })),
    });
  }

  return sections;
}
