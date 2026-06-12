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
} from "./api/server.js";
export type {
  ExactOriginCorsOptions,
  HealthPolicy,
  SapportaAuthGuard,
  SapportaEnv,
} from "./api/server.js";

// Table definition
export { table } from "./schema/table.js";
export type {
  TableDef,
  TableOptions,
  SapportaMeta,
  SapportaTableInputMeta,
  ColumnMeta,
  SelectMeta,
  ChildMeta,
} from "./schema/table.js";

// Schema loader
export { loadSchemas } from "./schema/loader.js";
export type { SchemaLoadResult } from "./schema/loader.js";

// Migration readiness
export { assertMigrationsReady } from "./migrations/guard.js";

// Validation
export { buildZodSchema, validate } from "./data/validate.js";
export type { ValidationErrorDetail } from "./data/validate.js";

// Save pipeline
export { savePipeline, insertRow, updateRow } from "./data/save-pipeline.js";

// Row-scoped table operations
export {
  ImmutableTableOperationError,
  RowNotFoundError,
  scopedRows,
} from "./data/scoped-rows.js";
export type {
  ListRowsInput,
  ListRowsResult,
  ScopedRows,
} from "./data/scoped-rows.js";

// Query parser
export { parseQuery } from "./data/query-parser.js";
export type { ParsedQuery } from "./data/query-parser.js";

// Schema API. Wire-shape types (`TableSchema`, `ColumnSchema`,
// `ChildSchema`) live in `@sapporta/shared/contracts` — import from
// there, not via this re-export.
export { schemaApi, extractSchemas, extractSchema } from "./schema/extract.js";

// Row labels
export { findRowLabelColumns, rowLabeller } from "./data/row-label.js";
export type { RowLabeller } from "./data/row-label.js";

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
} from "./load-sapporta.js";
export type {
  LoadSapportaProjectOptions,
  MountSapportaFrameworkOptions,
  SapportaFrameworkApi,
  SapportaProject,
} from "./load-sapporta.js";

// SQLite connection
export { connectProject } from "./db/sqlite-connection.js";
export type { ProjectDbConnection } from "./db/sqlite-connection.js";

// Errors
export { ValidationError, ActionError, QueryParseError } from "./db/errors.js";

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
} from "./project-paths.js";

// Test utilities
export { createTestDb } from "./testing/test-utils.js";

// Contract-driven API (ts-rest + Hono)
export * from "./api/index.js";
