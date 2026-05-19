// Library entry. Importing the CSS here ensures the Vite lib build emits
// dist/index.css (processed through Tailwind v4) alongside the JS bundles.
import "./index.css";

// ── Configuration ──
// Project frontends import `createApiClient` and `ApiError` from
// `@sapporta/shared/client` directly; they call `getApiBase` from here
// to point the typed client at the same API base as the framework UI.
export { getApiBase, API_ORIGIN, uiClient } from "./client";

// ── Stores ──
export { useSchemaStore } from "./stores/schema-store";
export { useDrawerStore } from "./stores/drawer-store";
export { useThemeStore, type ThemeMode } from "./stores/theme-store";
export {
  useHintsStore,
  useKeyHints,
  type KeyHint,
} from "./stores/hints-store";
export { setNavigate, getNavigate } from "./stores/router-bridge";

// ── Dispatchers ──
export {
  loadSchema,
  loadReports,
  navigateToTable,
  navigateToReport,
  createRecord,
  openDrawerCreate,
  closeDrawer,
} from "./stores/dispatchers";

// ── Route components ──
export { App } from "./App";
export { TableRoute } from "./routes/TableRoute";
export { ReportRoute } from "./routes/ReportRoute";

// ── Grid primitives (apps opt into these to hand-build grids) ──
export * from "./grid";
export {
  parseSortString,
  stringifySortOrder,
  cycleSort,
  sortOrderEqual,
} from "./lib/sort";

// ── Combobox (Popover + cmdk searchable picker) ──
export { Combobox } from "./components/ui/combobox";

// ── Report primitives (apps opt into these from their report views) ──
export { ReportView } from "./components/report/ReportView";
export {
  ReportSummaryStats,
  type ReportStat,
  type ReportSummaryStatsProps,
} from "./components/report/ReportSummaryStats";

// ── Value lookup primitives ──
export {
  CachedValueLookup,
  RecordValueLookup,
  StaticValueLookup,
  type LookupEntry,
  type LookupSubscription,
  type LookupValue,
  type ValueLookup,
} from "./modules/lookup-cache/value-lookup";
export {
  CachedSearchLookup,
  StaticSearchLookup,
  type LookupSearchPage,
  type LookupSearchRequest,
  type SearchLookup,
} from "./modules/lookup-cache/search-lookup";
export {
  startLoadingValueLookupEntriesForGridRows,
  type GridValueLookupColumn,
} from "./modules/lookup-cache/grid-row-loader";

// ── UI primitives (reusable across surfaces) ──
export { ParamPill, type ParamPillProps } from "./components/ui/param-pill";
export { Kbd } from "./components/ui/kbd";

// ── Layout components ──
export { AppShell } from "./components/layout/AppShell";
export {
  AppSidebar,
  SapportaMark,
  SidebarSectionLabel,
  SidebarNavItem,
} from "./components/layout/Sidebar";
export { SidebarShell } from "./components/layout/SidebarShell";
export { TopBar } from "./components/layout/TopBar";
export { StatusBar } from "./components/layout/StatusBar";

// Re-export HomeRedirect, BootLoader, NotFoundView for composition
// (scaffolded projects wrap their own <Routes> in <BootLoader> and drop in
// <NotFoundView /> as the catch-all to stay consistent with the framework UX).
export { HomeRedirect, BootLoader, NotFoundView } from "./App";
