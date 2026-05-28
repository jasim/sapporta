// @sapporta/server - public API

// Server
export { installSapportaDefaults } from "./api/server.js";
export type { SapportaEnv } from "./api/server.js";

// Table definition
export { table } from "./schema/table.js";
export type {
  TableDef,
  TableOptions,
  SapportaMeta,
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

// Query parser
export { parseQuery } from "./data/query-parser.js";
export type { ParsedQuery } from "./data/query-parser.js";

// CRUD
export { crud, handleList, handleGet, handleCreate, handleUpdate, handleDelete } from "./data/crud.js";

// Schema API. Wire-shape types (`TableSchema`, `ColumnSchema`,
// `ChildSchema`) live in `@sapporta/shared/contracts` — import from
// there, not via this re-export.
export { schemaApi, extractSchemas, extractSchema } from "./schema/extract.js";

// Lookup
export { lookupEndpoint, handleLookup } from "./data/lookup.js";
export { findRowLabelColumns, rowLabeller } from "./data/row-label.js";
export type { RowLabeller } from "./data/row-label.js";

// Count
export { countEndpoint, handleCount } from "./data/count.js";

// Schema registry
export { SchemaRegistry } from "./schema/registry.js";
export type { RegistryEntry } from "./schema/registry.js";

// Name validation
export { validateTableName, validateColumnName } from "./schema/reserved.js";

// Reports. Author-DSL types (`ReportDefinition`, `ReportTreeNode`,
// `ReportSource`, `ReportSort`, `ReportFooter`, `ReportColumn`,
// `TransformContext`) are defined here — they carry function fields
// that don't survive serialization. Wire-shape types (`ReportParam`,
// `ReportOutputNode`, `ReportFooterRow`, `ReportResult`,
// `SerializedReportStat`) live in `@sapporta/shared/contracts`.
export { report } from "./reports/report.js";
export type {
  ReportDefinition,
  ReportSource,
  ReportTreeNode,
  ReportSort,
  ReportFooter,
  ReportColumn,
  TransformContext,
} from "./reports/report.js";
export { executeReport } from "./reports/engine.js";
export { loadReports } from "./reports/loader.js";

// Framework boot for external projects that own their entry point.
// loadSapporta() encapsulates schema loading, migration readiness, and framework
// route mounting. mountOpenApi() is a separate, order-dependent step
// that publishes /api/openapi.json once all routes are registered.
export { loadSapporta, mountOpenApi } from "./load-sapporta.js";
export type { LoadSapportaOptions, LoadSapportaResult } from "./load-sapporta.js";

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
