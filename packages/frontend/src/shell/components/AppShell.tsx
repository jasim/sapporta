import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import {
  DesktopSidebar,
  MobileBottomNav,
  NavigationRail,
} from "./Sidebar";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import type { ReportMeta, TableSchema } from "@sapporta/shared/contracts";
import { Database, FileText } from "lucide-react";
import type { Navigation, NavigationSection } from "../navigation";

export interface AppShellProps {
  navigation?: Navigation;
  showFrameworkNavigation?: boolean;
}

export function AppShell({
  navigation = [],
  showFrameworkNavigation = true,
}: AppShellProps) {
  const { loaded, error, tables, reports } = useSchemaStore();
  const shellNavigation = useMemo(() => {
    const frameworkNavigation = showFrameworkNavigation
      ? frameworkNavigationSections({ tables, reports })
      : [];
    return [...navigation, ...frameworkNavigation];
  }, [navigation, reports, showFrameworkNavigation, tables]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
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
          {!loaded && !error && (
            <div className="flex items-center justify-center h-full text-sap-muted">
              Loading…
            </div>
          )}
          {loaded && <Outlet />}
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
  reports,
}: {
  tables: readonly TableSchema[];
  reports: readonly ReportMeta[];
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

  if (reports.length > 0) {
    sections.push({
      label: "Reports",
      items: reports.map((report) => ({
        label: report.label,
        to: `/reports/${report.name}`,
        icon: FileText,
      })),
    });
  }

  return sections;
}
