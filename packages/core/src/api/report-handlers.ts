/**
 * Handler factory for the /reports namespace.
 *
 * Reports are read-only — GET is the semantically correct method; POST
 * `/:name/execute` is the fallback for long param lists. Both paths feed
 * the same `executeReport()` engine.
 */

import type Database from "better-sqlite3";
import type { Env } from "hono";
import { executeReport } from "../reports/engine.js";
import { createReportSqlClient } from "../reports/sqlite-sql-client.js";
import type { ReportHandlers } from "./mount-reports.js";
import type { ReportDefinition } from "../reports/report.js";

function isMissingParamError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Required parameter");
}

export function makeReportHandlers<E extends Env>(
  reports: readonly ReportDefinition[],
  sqlite: Database.Database,
): ReportHandlers<E> {
  const sql = createReportSqlClient(sqlite);

  return {
    list: ({ c }) =>
      c.json({
        reports: reports.map((r) => ({
          name: r.name,
          label: r.label,
          params: r.params,
        })),
      }),

    detail: ({ report }) =>
      ({ c }) =>
        c.json({
          name: report.name,
          label: report.label,
          params: report.params,
          columns: report.tree.columns,
        }),

    results: ({ report }) =>
      async ({ c }) => {
        try {
          const params: Record<string, string> = {};
          for (const [key, value] of Object.entries(c.req.query())) {
            params[key] = value as string;
          }
          const result = await executeReport(sql, report, params);
          return c.json(result);
        } catch (err) {
          if (isMissingParamError(err)) {
            return c.json({ error: (err as Error).message }, 400);
          }
          throw err;
        }
      },

    execute: ({ report }) =>
      async ({ c, request }) => {
        try {
          const params = (request.body.params ?? {}) as Record<string, string>;
          const result = await executeReport(sql, report, params);
          return c.json(result);
        } catch (err) {
          if (isMissingParamError(err)) {
            return c.json({ error: (err as Error).message }, 400);
          }
          throw err;
        }
      },
  };
}
