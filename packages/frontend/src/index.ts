import "./index.css";

export { getApiBase, API_ORIGIN, uiClient } from "@/platform/client";

export { useSchemaStore } from "@/schema-catalog/state/schema-store";
export { useThemeStore, type ThemeMode } from "@/shell/state/theme-store";
export {
  useHintsStore,
  useKeyHints,
  type KeyHint,
} from "@/shell/state/hints-store";
export { setNavigate, getNavigate } from "@/app/router/router-bridge";

export {
  loadSchema,
  loadReports,
  loadProjectInfo,
} from "@/schema-catalog/actions/metadata";
export { navigateToTable, navigateToReport } from "@/app/actions/navigation";
export {
  createRecord,
  navigateToNewRecord,
} from "@/table/actions/record-actions";

export { AccountProfilePage } from "@/auth/components/AccountProfilePage";
export {
  AuthGate,
  ForgotPasswordPage,
  LoginPage,
  PublicOnlyGate,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
  fetchAuthBootstrapStatus,
  fetchAuthContext,
  signOut,
  switchActiveWorkspace,
  useAuthStore,
  type AuthState,
  type AuthStatus,
} from "@/auth";
export { BootLoader } from "@/app/boot/BootLoader";
export { HomeRedirect } from "@/app/boot/HomeRedirect";
export { NotFoundView } from "@/app/boot/NotFoundView";
export { TableRoute } from "@/table/route/TableRoute";
export { NewRecordRoute } from "@/table/route/NewRecordRoute";
export { ReportRoute } from "@/report/route/ReportRoute";
export { NewRecordPage } from "@/table/form/NewRecordPage";
export { RecordFormField } from "@/table/form/RecordFormField";
export {
  RecordFormProvider,
  useRecordFieldValue,
  useRecordFormSetValue,
  useRecordFormStore,
} from "@/table/form/RecordFormProvider";
export {
  compactRecordFormValues,
  createRecordFormStore,
  initialRecordFormValues,
  type RecordFormState,
  type RecordFormStore,
  type RecordFormValues,
} from "@/table/form/record-form-store";
export * from "@/table";

export { ReportView } from "@/report/view/ReportView";
export {
  ReportSummaryStats,
  type ReportStat,
  type ReportSummaryStatsProps,
} from "@/report/components/ReportSummaryStats";

export { AppShell, type AppShellProps } from "@/shell/components/AppShell";
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
} from "@/shell/components/AccountMenu";
export {
  AuthAccountMenu,
  type AuthAccountMenuProps,
} from "@/shell/components/AuthAccountMenu";
export {
  SapportaMark,
} from "@/shell/components/Sidebar";
export { SidebarShell } from "@/shell/components/SidebarShell";
export { TopBar } from "@/shell/components/TopBar";
export { StatusBar } from "@/shell/components/StatusBar";
export {
  isNavigationItemActive,
  navigationItems,
  type Navigation,
  type NavigationIcon,
  type NavigationItem,
  type NavigationSection,
} from "@/shell/navigation";
