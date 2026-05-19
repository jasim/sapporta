/**
 * Browser- and server-safe contract surface for `@sapporta/shared`.
 *
 * Both `@sapporta/server` (handler registration via `api.register(...)`)
 * and `@sapporta/ui` / scaffolded frontends (`createApiClient(uiContract)`)
 * import their contracts and wire-shape types from here.
 *
 * Anything re-exported MUST be reachable without evaluating any Node-
 * only or framework-specific module — `zod` and `@sapporta/rest-core` only.
 */

// ── Errors ──────────────────────────────────────────────────────────────────
export { errorBodySchema, ApiError, type ErrorBody } from "./error.js";

// ── Meta wire shapes ────────────────────────────────────────────────────────
export {
  columnSchemaSchema,
  childSchemaSchema,
  tableSchemaSchema,
  reportLinkSchema,
  linkBindSchema,
  linkIconSchema,
  foreignKeyRefSchema,
  selectOptionsSchema,
  projectInfoSchema,
  type ColumnSchema,
  type ChildSchema,
  type TableSchema,
  type ReportLink,
  type LinkBind,
  type LinkIcon,
  type ProjectInfo,
} from "./meta-schema.js";

// ── Table wire shapes ───────────────────────────────────────────────────────
export {
  rowSchema,
  listMetaSchema,
  paginatedRowsSchema,
  singleRowSchema,
  lookupResponseSchema,
  countResponseSchema,
  listRowsQuerySchema,
  lookupQuerySchema,
  countQuerySchema,
  type Row,
  type ListMeta,
  type PaginatedRows,
  type SingleRow,
  type LookupResponse,
  type CountResponse,
  type ListRowsQuery,
  type LookupQuery,
  type CountQuery,
} from "./table-schema.js";

// ── Report wire shapes ──────────────────────────────────────────────────────
export {
  paramTypeSchema,
  reportParamSchema,
  reportMetaSchema,
  reportFooterRowSchema,
  reportOutputNodeSchema,
  reportResultSchema,
  reportsListResponseSchema,
  serializedReportStatSchema,
  type ParamType,
  type ReportParam,
  type ReportMeta,
  type ReportFooterRow,
  type ReportOutputNode,
  type ReportResult,
  type ReportsListResponse,
  type SerializedReportStat,
} from "./report-schema.js";

// ── Routes ──────────────────────────────────────────────────────────────────
export {
  projectInfoRoute,
  listTablesRoute,
  getTableRoute,
  tableSampleRoute,
  tableIndexesRoute,
  sqlRoute,
  schemaSyncRoute,
} from "./meta-routes.js";

export {
  listRowsRoute,
  getRowRoute,
  createRowRoute,
  updateRowRoute,
  deleteRowRoute,
  lookupRoute,
  countRoute,
} from "./table-routes.js";

export { listReportsRoute, runReportRoute } from "./report-routes.js";

export { uiContract, type UiContract } from "./ui-contract.js";

// ── ts-rest passthroughs (so consumers don't need a direct dep) ─────────────
export {
  initContract,
  type AppRoute,
  type AppRouter,
  type ServerInferRequest,
  type ServerInferResponses,
  type ServerInferResponseBody,
  type ClientInferResponses,
  type ClientInferResponseBody,
} from "@sapporta/rest-core";
