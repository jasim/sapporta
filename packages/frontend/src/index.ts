import "./index.css";

export { getApiBase, API_ORIGIN, uiClient } from "./platform/client";

export { useSchemaStore } from "./schema-catalog/state/schema-store";
export { useThemeStore, type ThemeMode } from "./shell/state/theme-store";
export {
  useHintsStore,
  useKeyHints,
  type KeyHint,
} from "./shell/state/hints-store";
export { setNavigate, getNavigate } from "./app/router/router-bridge";

export { loadSchema, loadProjectInfo } from "./schema-catalog/actions/metadata";
export { navigateToTable } from "./app/actions/navigation";
export {
  createRecord,
  navigateToNewRecord,
} from "./table/actions/record-actions";

export { AccountProfilePage } from "./auth/components/AccountProfilePage";
export { ChangePasswordPage } from "./auth/components/ChangePasswordPage";
export {
  AuthGate,
  ForgotPasswordPage,
  LoginPage,
  PublicOnlyGate,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
  changePassword,
  fetchAuthBootstrapStatus,
  fetchAuthContext,
  signOut,
  switchActiveWorkspace,
  useAuthStore,
  type AuthState,
  type AuthSession,
  type ChangePasswordInput,
} from "./auth";
export { BootLoader } from "./app/boot/BootLoader";
export { HomeRedirect } from "./app/boot/HomeRedirect";
export { NotFoundView } from "./app/boot/NotFoundView";
export {
  TableRoute,
  type TableGridOptionsByTable,
  type TableRouteProps,
} from "./table/route/TableRoute";
export { NewRecordRoute } from "./table/route/NewRecordRoute";
export { NewRecordPage } from "./table/form/NewRecordPage";
export * from "./table";
export * from "./form";

export * from "./lookup";

export * from "./links";

export * from "./report";

export { AppShell, type AppShellProps } from "./shell/components/AppShell";
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
