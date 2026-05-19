import { resolve } from "node:path";
import { loadReports } from "../reports/loader.js";
import { loadSchemas } from "../schema/loader.js";
import { checkReportDefinition, checkReportSqlColumns, type CheckSql } from "../reports/check.js";
import { checkSchemaDefinitions } from "../schema/check.js";
import type { OperationResult } from "../introspect/types.js";
import { parseFlags } from "./format.js";
import { connectProject } from "../db/sqlite-connection.js";
import { resolveProjectContext } from "./project-context.js";
import { fromApiCodeDir } from "../project-paths.js";

/**
 * Validate project schemas and reports statically (and optionally with DB).
 *
 * Returns structured validation results. The router is responsible for
 * setting the exit code based on result.meta.hasIssues.
 *
 * Note: This command still renders its own text output via meta.message
 * because the checkmark/cross-mark format doesn't map to a simple table.
 */
export async function check(args: string[]): Promise<OperationResult> {
  const flags = parseFlags(args);
  const ctx = await resolveProjectContext(flags);

  if (!ctx.dir) {
    return {
      ok: false,
      error: "Cannot check an API-created project — it has no schema directory",
      code: "VALIDATION_FAILED",
    };
  }
  const projectDir = resolve(ctx.dir);
  const { schemaDir, reportsDir } = fromApiCodeDir(projectDir);

  let hasIssues = false;
  const allIssues: Record<string, unknown>[] = [];
  let textOutput = "";

  // -- Schema checks --
  let schemas;
  try {
    schemas = await loadSchemas(schemaDir);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      return {
        ok: false,
        error: `Error loading schemas from ${schemaDir}: ${err.message}`,
        code: "INTERNAL",
      };
    }
  }

  if (schemas && schemas.tables.length > 0) {
    const schemaIssues = checkSchemaDefinitions(schemas.tables);

    textOutput += `\nChecking schemas: ${schemas.tables.length} table(s)\n`;
    if (schemaIssues.length === 0) {
      textOutput += "  \u2713 No issues found\n";
    } else {
      hasIssues = true;
      for (const issue of schemaIssues) {
        textOutput += `  \u2717 ${issue.table}.${issue.column}: ${issue.message}\n`;
        allIssues.push({
          type: "schema",
          table: issue.table,
          column: issue.column,
          message: issue.message,
        });
      }
    }
  }

  // -- Report checks --
  let reports: Awaited<ReturnType<typeof loadReports>> | undefined = undefined;
  try {
    reports = await loadReports(reportsDir);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      return {
        ok: false,
        error: `Error loading reports from ${reportsDir}: ${err.message}`,
        code: "INTERNAL",
      };
    }
  }

  if (reports && reports.length > 0) {
    const issuesByReport = new Map<string, { name: string; issues: { path: string; message: string }[] }>();
    for (const report of reports) {
      issuesByReport.set(report.name, {
        name: report.name,
        issues: checkReportDefinition(report),
      });
    }

    // DB-aware checks: discover SQL column metadata via the query planner.
    // Open a SQLite connection and adapt it to the CheckSql interface that
    // checkReportSqlColumns expects.
    let conn: ReturnType<typeof connectProject> | null = null;
    try {
      conn = connectProject(ctx.databasePath);
    } catch {
      // Database may not exist yet (e.g. `check` run before first serve)
    }

    if (conn) {
      try {
        const checkSql: CheckSql = {
          async unsafe(query: string, params?: unknown[]) {
            const stmt = conn!.sqlite.prepare(query);
            const columns = stmt.columns().map((c: any) => ({ name: c.name }));
            const rows = params && params.length > 0 ? stmt.all(...params) : stmt.all();
            (rows as any).columns = columns;
            return rows as any;
          },
        };
        for (const report of reports) {
          const dbIssues = await checkReportSqlColumns(checkSql, report);
          const entry = issuesByReport.get(report.name)!;
          entry.issues.push(...dbIssues);
        }
      } finally {
        conn.sqlite.close();
      }
    }

    let reportsWithIssues = 0;

    for (const report of reports) {
      textOutput += `\nChecking report: ${report.name}\n`;
      const { issues } = issuesByReport.get(report.name)!;

      if (issues.length === 0) {
        textOutput += "  \u2713 No issues found\n";
      } else {
        reportsWithIssues++;
        for (const issue of issues) {
          textOutput += `  \u2717 ${issue.path}: ${issue.message}\n`;
          allIssues.push({
            type: "report",
            report: report.name,
            path: issue.path,
            message: issue.message,
          });
        }
      }
    }

    textOutput += `\n${reports.length} report(s) checked, ${reportsWithIssues} with issues\n`;

    if (reportsWithIssues > 0) {
      hasIssues = true;
    }
  }

  if (!schemas?.tables.length && !reports?.length) {
    textOutput += `No schemas or reports found in ${projectDir}\n`;
  }

  return {
    ok: true,
    data: allIssues,
    meta: {
      message: textOutput.trimEnd(),
      hasIssues,
      tableOutputHandled: true,
    },
  };
}
