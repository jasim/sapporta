// @sapporta/server - public API

// Auth
export * from "./auth/index.js";

// Server
export {
  installExactOriginCors,
  installFrameworkRoutePolicy,
  installRequestLogging,
  installSapportaDefaults,
  installSapportaErrorHandler,
  mountHealth,
  OPENAPI_PATH,
} from "./api/server.js";
export type {
  ExactOriginCorsOptions,
  FrameworkRoutePolicyOptions,
  HealthPolicy,
  OpenApiPolicy,
  SapportaAuthGuard,
  SapportaEnv,
} from "./api/server.js";

// Table definition
export {
  bool,
  date,
  money,
  number,
  percentage,
  sapportaTable,
  select,
  text,
  timestamp,
} from "./schema/table.js";
export { columnBySqlName, columnPropertyName } from "./schema/column.js";
export type {
  TableDef,
  TableOptions,
  SapportaMeta,
  SapportaTableInputMeta,
  ColumnMeta,
  ChildMeta,
  TableValidation,
  TableValidationContext,
  TableValidationField,
  TableValidationValue,
} from "./schema/table.js";

// Schema loader
export { loadSchemas } from "./schema/loader.js";
export type { SchemaLoadResult } from "./schema/loader.js";

// Schema validation
export {
  assertSchemaDefinitions,
  SchemaValidationError,
} from "./schema/check.js";
export type { SchemaIssue } from "./schema/check.js";

// Migration readiness
export { assertMigrationsReady } from "./migrations/guard.js";

// Canonical table API, save-boundary, and column-value Zod
export {
  getColumnEnumValues,
  zodForColumnValue,
} from "./schema/table-value-zod.js";
export type {
  ColumnValueZod,
  TableObjectZod,
} from "./schema/table-value-zod.js";
export { tableApiZod } from "./api/table-api-zod.js";
export { tableWriteZod } from "./rows/table-write-zod.js";
export { parseTableWrite } from "./rows/validate.js";
export type {
  TableWriteParseResult,
  ValidationErrorDetail,
} from "./rows/validate.js";

// Save pipeline
export { savePipeline, insertRow, updateRow } from "./rows/save-pipeline.js";

// Row-scoped table operations
export {
  ImmutableTableOperationError,
  RowNotFoundError,
  scopedRows,
} from "./rows/scoped-rows.js";
export type {
  CountRowsByInput,
  CountRowsInput,
  FindManyRowsInput,
  LookupRowsByIdInput,
  LookupRowsBySearchInput,
  LookupRowsInput,
  PageRowsInput,
  PageRowsResult,
  RowsOrderBy,
  RowsQuery,
  ScopedRows,
  TableColumn,
  TableRow,
} from "./rows/scoped-rows.js";
export { scanTableRows } from "./rows/table-row-scan.js";
export type {
  TableRowScanInput,
  TableRowScanOrder,
} from "./rows/table-row-scan.js";
export type { GroupCount } from "@sapporta/shared";

// Generated table HTTP query resolvers
export {
  resolveCountQuery,
  resolveExportQuery,
  resolveLookupQuery,
  resolvePageQuery,
} from "./api/table-query.js";
export type {
  ResolvedCountQuery,
  ResolveRowsQueryOptions,
} from "./api/table-query.js";

// Table search planning and request-bound SQL compilation
export { normalizeTableSearch } from "./search/search-types.js";
export type {
  NormalizedTableSearch,
  SearchSelf,
  TableSearch,
} from "./search/search-types.js";
export {
  compileSearchPlans,
  SearchPlanValidationError,
} from "./search/search-plan.js";
export type {
  ChildSearchPlan,
  CompiledSearchPlans,
  SearchPlan,
  SearchPlanIssue,
  SearchPlanWarning,
  SearchValuePlan,
} from "./search/search-plan.js";
export { buildSearchPredicate } from "./search/search-sql.js";

// Schema API. Wire-shape types (`TableSchema`, `ColumnSchema`,
// `ChildSchema`) live in `@sapporta/shared/contracts` — import from
// there, not via this re-export.
export { schemaApi, extractSchemas, extractSchema } from "./schema/extract.js";

// Row labels
export { findRowLabelColumns, rowLabeller } from "./rows/row-label.js";
export type { RowLabeller } from "./rows/row-label.js";

// Table catalog
export { createTableCatalog } from "./schema/catalog.js";
export type { TableCatalog } from "./schema/catalog.js";

// Name validation
export { validateTableName, validateColumnName } from "./schema/reserved.js";

// Framework boot for external projects that own their entry point.
export {
  installSapportaRequestContext,
  loadSapportaProject,
  mountOpenApi,
  mountSapportaFramework,
} from "./project/load-sapporta.js";
export type {
  LoadSapportaProjectOptions,
  MountSapportaFrameworkOptions,
  SapportaFrameworkApi,
  SapportaProject,
} from "./project/load-sapporta.js";

// SQLite connection
export { connectProject } from "./db/sqlite-connection.js";
export type { ProjectDbConnection } from "./db/sqlite-connection.js";

// Errors
export { ValidationError, ActionError, QueryParseError } from "./errors.js";

// Project paths
export {
  PROJECT_MARKER,
  WATCHABLE_SUBDIRS,
  fromProjectRoot,
  fromApiCodeDir,
  projectRootFromDbPath,
  storeDbPath,
  findProjectRootFrom,
  setProjectRoot,
  projectRoot,
  projectPath,
} from "./project/project-paths.js";

// Contract-driven API (ts-rest + Hono)
export * from "./api/index.js";
