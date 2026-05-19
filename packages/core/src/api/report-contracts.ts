/**
 * Per-report contract factories.
 *
 * The static `listReportsRoute` and the loose name-generic `runReportRoute`
 * live in `@sapporta/shared/contracts` (used by both server registration
 * and generic clients). The factories below produce per-report routes
 * keyed on a `ReportDefinition` — `registerFamily` in `mount-reports.ts`
 * uses them so each report's params appear in the OpenAPI spec under
 * its own concrete path.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import type { ReportDefinition } from "../reports/report.js";

const c = initContract();
const looseObject = z.record(z.string(), z.unknown());

export function reportDetailRoute(report: ReportDefinition) {
  return c.query({
    method: "GET",
    path: `/reports/${report.name}`,
    summary: `Report metadata — ${report.label}`,
    metadata: { tags: ["reports"] },
    responses: {
      200: looseObject,
      404: errorBodySchema,
    },
  });
}

export function reportResultsRoute(report: ReportDefinition) {
  return c.query({
    method: "GET",
    path: `/reports/${report.name}/results`,
    summary: `Execute report — ${report.label}`,
    metadata: { tags: ["reports"] },
    query: z.record(z.string(), z.string()).optional(),
    responses: {
      200: looseObject,
      400: errorBodySchema,
      404: errorBodySchema,
    },
  });
}

export function reportExecuteRoute(report: ReportDefinition) {
  return c.mutation({
    method: "POST",
    path: `/reports/${report.name}/execute`,
    summary: `Execute report (JSON body) — ${report.label}`,
    metadata: { tags: ["reports"] },
    body: z.object({ params: z.record(z.string(), z.unknown()).optional() }).loose(),
    responses: {
      200: looseObject,
      400: errorBodySchema,
      404: errorBodySchema,
    },
  });
}
