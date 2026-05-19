/**
 * Mount the /reports namespace on a `TsRestApi`.
 *
 * `GET /reports` (static) is registered with `api.register`. The per-report
 * routes use `registerFamily` so the one generic Hono route dispatches to
 * the resolved report and `docs()` emits one concrete OpenAPI entry per
 * registered report (per-report params survive into the spec).
 *
 * Mount order: static `/reports` first so the parametric `/reports/:name`
 * family registered afterwards doesn't shadow the list endpoint.
 */

import type { Context, Env } from "hono";
import type { AppRoute } from "@sapporta/rest-core";
import type { ReportDefinition } from "../reports/report.js";
import type { RouteHandler, TsRestApi } from "@sapporta/honest";
import { listReportsRoute } from "@sapporta/shared/contracts";
import {
  reportDetailRoute,
  reportExecuteRoute,
  reportResultsRoute,
} from "./report-contracts.js";

export interface ReportsDocContext {
  reports: readonly ReportDefinition[];
}

export interface ReportHandlers<E extends Env> {
  list: RouteHandler<typeof listReportsRoute, E>;
  detail: (args: {
    report: ReportDefinition;
    route: ReturnType<typeof reportDetailRoute>;
  }) => RouteHandler<ReturnType<typeof reportDetailRoute>, E>;
  results: (args: {
    report: ReportDefinition;
    route: ReturnType<typeof reportResultsRoute>;
  }) => RouteHandler<ReturnType<typeof reportResultsRoute>, E>;
  execute: (args: {
    report: ReportDefinition;
    route: ReturnType<typeof reportExecuteRoute>;
  }) => RouteHandler<ReturnType<typeof reportExecuteRoute>, E>;
}

function reportNotFound<E extends Env>(c: Context<E>): Response {
  const name = c.req.param("name");
  return c.json(
    {
      error: name ? `Report "${name}" not found` : "Report name required",
      code: "REPORT_NOT_FOUND",
    },
    404,
  );
}

function asGenericHandler<R extends AppRoute, E extends Env>(
  h: RouteHandler<R, E>,
): RouteHandler<AppRoute, E> {
  return h as unknown as RouteHandler<AppRoute, E>;
}

export function mountReports<
  E extends Env,
  DocCtx extends ReportsDocContext = ReportsDocContext,
>(
  api: TsRestApi<E, DocCtx>,
  reports: readonly ReportDefinition[],
  handlers: ReportHandlers<E>,
): TsRestApi<E, DocCtx> {
  // Static listing first so the family below doesn't swallow it.
  api.register("listReports", listReportsRoute, handlers.list);

  const findReport = (name: string) => reports.find((r) => r.name === name);

  // Specific per-report paths before the bare detail path.
  api.registerFamily({
    method: "get",
    genericPath: "/reports/:name/results",
    docs: (ctx) =>
      Object.fromEntries(
        ctx.reports.map((r) => [`reportResults_${r.name}`, reportResultsRoute(r)]),
      ),
    dispatch: (c) => {
      const report = findReport(c.req.param("name") ?? "");
      if (!report) return undefined;
      const route = reportResultsRoute(report);
      return {
        route,
        handler: asGenericHandler(handlers.results({ report, route })),
      };
    },
    notFound: reportNotFound<E>,
  });

  api.registerFamily({
    method: "post",
    genericPath: "/reports/:name/execute",
    docs: (ctx) =>
      Object.fromEntries(
        ctx.reports.map((r) => [`reportExecute_${r.name}`, reportExecuteRoute(r)]),
      ),
    dispatch: (c) => {
      const report = findReport(c.req.param("name") ?? "");
      if (!report) return undefined;
      const route = reportExecuteRoute(report);
      return {
        route,
        handler: asGenericHandler(handlers.execute({ report, route })),
      };
    },
    notFound: reportNotFound<E>,
  });

  api.registerFamily({
    method: "get",
    genericPath: "/reports/:name",
    docs: (ctx) =>
      Object.fromEntries(
        ctx.reports.map((r) => [`reportDetail_${r.name}`, reportDetailRoute(r)]),
      ),
    dispatch: (c) => {
      const report = findReport(c.req.param("name") ?? "");
      if (!report) return undefined;
      const route = reportDetailRoute(report);
      return {
        route,
        handler: asGenericHandler(handlers.detail({ report, route })),
      };
    },
    notFound: reportNotFound<E>,
  });

  return api;
}
