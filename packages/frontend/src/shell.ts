export {
  AccountMenu,
  formatAuthRole,
  getAccountDisplayName,
  getAccountInitials,
  getAccountSecondaryLabel,
  type AccountMenuAction,
  type AccountMenuProps,
  type AccountMenuSection,
  type AccountMenuTriggerRenderProps,
} from "./shell/components/AccountMenu";
export {
  AuthAccountMenu,
  type AuthAccountMenuProps,
} from "./shell/components/AuthAccountMenu";
export { SapportaMark } from "./shell/components/Sidebar";
export { AppShell, type AppShellProps } from "./shell/components/AppShell";
export { SidebarShell } from "./shell/components/SidebarShell";
export {
  SidebarRegion,
  type SidebarRegionProps,
} from "./shell/components/SidebarRegion";
export {
  SidebarToggle,
  type SidebarToggleProps,
} from "./shell/components/SidebarToggle";
export {
  AppPage,
  PageBody,
  PageFrame,
  type AppPageProps,
  type PageBodyProps,
  type PageFrameProps,
} from "./shell/components/Page";
export {
  PageHeader,
  PageHeaderButton,
  type PageHeaderProps,
} from "./shell/components/PageHeader";
export { usePageTitle, resetPageTitles } from "./shell/document-title";
export {
  SidebarProvider,
  useSidebar,
  SIDEBAR_DESKTOP_MEDIA_QUERY,
  SIDEBAR_EXPANDED_PREF_KEY,
  type SidebarController,
  type SidebarProviderOptions,
  type SidebarProviderProps,
} from "./shell/sidebar-controller";
export { StatusBar } from "./shell/components/StatusBar";
export {
  isNavigationItemActive,
  navigationItems,
  type Navigation,
  type NavigationIcon,
  type NavigationItem,
  type NavigationSection,
} from "./shell/navigation";
export {
  useDocumentTheme,
  useThemeStore,
  type ThemeMode,
} from "./shell/state/theme-store";
/**
 * The toast outlet Sapporta's screens post to. `AppShell` renders one; an app
 * that composes its own shell renders this same export once, near the root,
 * or toasts from the workspace settings and password screens never appear.
 *
 * Render it above `BootLoader`. A workspace switch or a time zone change
 * resets the schema store, and the gate remounts everything under it; a
 * toast posted at that moment needs an outlet that stayed mounted.
 */
export { Toaster, type ToasterProps } from "sonner";
