/**
 * Generic, report-name-agnostic routes.
 *
 * `listReportsRoute` returns the typed `reportMetaSchema` envelope; the
 * UI's report picker reads `params` off that. `runReportRoute` returns
 * the recursive `reportResultSchema` — typed at the envelope level (
 * `name`, `params`, `levelColumns`, `data: ReportOutputNode[]`); per-
 * report column values inside `node.columns` stay loose because they
 * vary with the report's SQL.
 *
 * The per-report factory routes (`reportDetailRoute(report)` etc.) live
 * in `core/src/api/report-contracts.ts`; they bake the report name into
 * the path and need a `ReportDefinition`. The framework registers them
 * via `mount-reports.ts::registerFamily` so each report's params survive
 * into the OpenAPI spec under its own concrete path.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "./error.js";
import {
  reportResultSchema,
  reportsListResponseSchema,
} from "./report-schema.js";

const c = initContract();

export const listReportsRoute = c.query({
  method: "GET",
  path: "/reports",
  summary: "List available reports",
  metadata: { tags: ["reports"] },
  responses: {
    200: reportsListResponseSchema,
  },
});

export const runReportRoute = c.query({
  method: "GET",
  path: "/reports/:name/results",
  summary: "Execute any report by name",
  metadata: { tags: ["reports"] },
  pathParams: z.object({ name: z.string() }),
  query: z.record(z.string(), z.string()).optional(),
  responses: {
    200: reportResultSchema,
    400: errorBodySchema,
    404: errorBodySchema,
  },
});
