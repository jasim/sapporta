// Library entry. Importing the CSS here ensures the Vite lib build emits
// dist/index.css (processed through Tailwind v4) alongside the JS bundles.
import "./index.css";

// Configuration
export { getApiBase, API_ORIGIN, uiClient } from "@/platform/client";

// Stores
export { useSchemaStore } from "@/schema-catalog/state/schema-store";
export { useThemeStore, type ThemeMode } from "@/shell/state/theme-store";
export {
  useHintsStore,
  useKeyHints,
  type KeyHint,
} from "@/shell/state/hints-store";
export { setNavigate, getNavigate } from "@/app/router/router-bridge";

// Actions
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

// Default admin and routes
export { App } from "@/app/App";
export { BootLoader } from "@/app/boot/BootLoader";
export { HomeRedirect } from "@/app/boot/HomeRedirect";
export { NotFoundView } from "@/app/boot/NotFoundView";
export { TableRoute } from "@/table/route/TableRoute";
export { NewRecordRoute } from "@/table/route/NewRecordRoute";
export { ReportRoute } from "@/report/route/ReportRoute";
export { NewRecordPage } from "@/table/form/NewRecordPage";

// Grid primitives
export * from "@/grid";
export {
  parseSortString,
  stringifySortOrder,
  cycleSort,
  sortOrderEqual,
} from "@/grid/sort";

// Column preset primitives
export * from "@/column-preset";

// Combobox (Popover + cmdk searchable picker)
export { Combobox } from "@/ui/composite/combobox";

// Report primitives
export { ReportView } from "@/report/view/ReportView";
export {
  ReportSummaryStats,
  type ReportStat,
  type ReportSummaryStatsProps,
} from "@/report/components/ReportSummaryStats";

// Value lookup primitives
export {
  CachedValueLookup,
  RecordValueLookup,
  StaticValueLookup,
  type LookupEntry,
  type LookupSubscription,
  type LookupValue,
  type ValueLookup,
} from "@/lookup/cache/value-lookup";
export {
  CachedSearchLookup,
  StaticSearchLookup,
  type LookupSearchPage,
  type LookupSearchRequest,
  type SearchLookup,
} from "@/lookup/cache/search-lookup";
export {
  startLoadingValueLookupEntriesForGridRows,
  type GridValueLookupColumn,
} from "@/lookup/cache/grid-row-loader";

// UI primitives
export { ParamPill, type ParamPillProps } from "@/ui/composite/param-pill";
export { Kbd } from "@/ui/composite/kbd";

// Layout components
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
