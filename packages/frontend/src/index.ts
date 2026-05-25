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

export { App } from "@/app/App";
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

export { AppShell } from "@/shell/components/AppShell";
export {
  AppSidebar,
  SapportaMark,
  SidebarSectionLabel,
  SidebarNavItem,
} from "@/shell/components/Sidebar";
export { SidebarShell } from "@/shell/components/SidebarShell";
export { TopBar } from "@/shell/components/TopBar";
export { StatusBar } from "@/shell/components/StatusBar";
