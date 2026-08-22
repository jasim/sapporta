import { useMemo, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar, MobileBottomNav, NavigationRail } from "./Sidebar";
import { Toaster } from "sonner";
import { cn } from "@sapporta/ui/cn";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { useAuthStore } from "../../auth/state/auth-store";
import type { TableSchema } from "@sapporta/shared/contracts";
import { Database } from "lucide-react";
import type { Navigation, NavigationSection } from "../navigation";
import {
  SidebarProvider,
  useSidebar,
  type SidebarProviderOptions,
} from "../sidebar-controller";
import { SidebarRegion } from "./SidebarRegion";
import { SidebarToggle } from "./SidebarToggle";
import { AppPage } from "./Page";

export interface AppShellProps {
  navigation?: Navigation;
  showFrameworkNavigation?: boolean;
  /** Configure the responsive sidebar controller used by the standard shell. */
  sidebarOptions?: Omit<SidebarProviderOptions, "desktopMediaQuery">;
  /**
   * Replace the shell-owned sidebar control, or set this to `false` when your
   * application places `SidebarToggle` in its own persistent UI.
   */
  sidebarToggle?: ReactNode | false;
}

/**
 * The standard shell keeps navigation reachable without asking each route to
 * render a particular header. On desktop, the collapse control sits with the
 * expanded navigation; once collapsed, its expand control moves to the
 * content's top-left. Compact screens keep the opener there for the drawer.
 * `PageHeader` leaves room only while that content-side control is present.
 *
 * Route content still chooses its own layout. An `AppPage` fills the available
 * height and scrolls its body, while an unwrapped application page can grow
 * naturally and let the shell scroll it.
 *
 * Navigation appears once a visitor has a session. A public page therefore
 * renders on its own, without links the visitor cannot open yet.
 */
export function AppShell({
  navigation = [],
  showFrameworkNavigation = true,
  sidebarOptions,
  sidebarToggle,
}: AppShellProps) {
  const { error, tables } = useSchemaStore();
  const session = useAuthStore((s) => s.session);
  const showNavigation = session.kind === "authenticated";
  const shellNavigation = useMemo(() => {
    const frameworkNavigation = showFrameworkNavigation
      ? frameworkNavigationSections({ tables })
      : [];
    return [...navigation, ...frameworkNavigation];
  }, [navigation, showFrameworkNavigation, tables]);

  return (
    <SidebarProvider {...sidebarOptions}>
      <AppShellLayout
        navigation={navigation}
        shellNavigation={shellNavigation}
        showNavigation={showNavigation}
        error={error}
        sidebarToggle={sidebarToggle}
      />
    </SidebarProvider>
  );
}

function AppShellLayout({
  navigation,
  shellNavigation,
  showNavigation,
  error,
  sidebarToggle,
}: {
  navigation: Navigation;
  shellNavigation: Navigation;
  showNavigation: boolean;
  error: string | null;
  sidebarToggle?: ReactNode | false;
}) {
  const sidebar = useSidebar();
  const shellSidebarToggle =
    sidebarToggle === undefined ? <SidebarToggle /> : sidebarToggle;
  const hasShellSidebarToggle =
    showNavigation && shellSidebarToggle !== false && shellSidebarToggle != null;
  const showSidebarToggleInSidebar =
    hasShellSidebarToggle && sidebar.isDesktop && sidebar.desktopExpanded;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
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
      <div className="flex min-h-0 flex-1">
        {showNavigation && (
          <SidebarRegion>
            <AppSidebar
              navigation={shellNavigation}
              sidebarToggle={
                showSidebarToggleInSidebar ? shellSidebarToggle : undefined
              }
            />
          </SidebarRegion>
        )}
        {showNavigation && !sidebar.isDesktop && (
          <NavigationRail navigation={shellNavigation} />
        )}
        <div data-shell-content className="relative min-w-0 flex-1">
          {hasShellSidebarToggle && !showSidebarToggleInSidebar && (
            <div
              data-shell-sidebar-toggle
              data-sidebar-toggle-location="content"
              className="absolute left-2 top-1.5 z-[calc(var(--sap-z-shell-sticky)+1)]"
            >
              {shellSidebarToggle}
            </div>
          )}
          <main
            data-shell-scroll-region
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-y-auto bg-sap-surface md:pb-0",
              showNavigation && "pb-[56px]",
            )}
          >
            {error ? (
              <AppPage
                title="Could not load the app schema"
                bodyClassName="p-8 text-destructive"
              >
                {error}
              </AppPage>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
        {showNavigation && (
          <MobileBottomNav
            navigation={navigation}
            pickerNavigation={shellNavigation}
          />
        )}
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
