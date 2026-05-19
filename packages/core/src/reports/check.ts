import type { ReportOutputNode } from "@sapporta/shared/contracts";
import type { ReportDefinition, ReportTreeNode } from "./report.js";
import {
  extractBindVariables,
  buildPositionalQuery,
} from "./engine.js";

export type CheckIssue = {
  /** Dot-separated path through the tree, e.g. "section.footer[\"Grand Total\"]" */
  path: string;
  /** Human-readable description of the issue */
  message: string;
};

/**
 * Statically validate a report definition without executing any SQL.
 *
 * Checks performed (recursively over the tree):
 *  1. Source references — each node's `source` must exist in the report's `sources` map
 *  2. Rollup keys vs columns — call rollup() with empty children to discover output keys,
 *     warn if any key isn't in columns[] on that level
 *  3. Footer keys vs columns — call each footer.compute([]) to discover output keys,
 *     warn if any key isn't in columns[] on that level
 */
export function checkReportDefinition(def: ReportDefinition): CheckIssue[] {
  const issues: CheckIssue[] = [];
  walkTree(def.tree, def, issues, def.tree.levelName);
  return issues;
}

function walkTree(
  node: ReportTreeNode,
  def: ReportDefinition,
  issues: CheckIssue[],
  path: string,
): void {
  const declaredNames = new Set(node.columns.map((c) => c.name));

  // 1. Source reference check
  if (!(node.source in def.sources)) {
    issues.push({
      path,
      message: `source "${node.source}" not found in sources`,
    });
  }

  // 2. Rollup keys vs columns
  if (node.rollup && node.children && node.children.length > 0) {
    try {
      // Build mock children map: { childLevelName: [] } for each child
      const mockChildren: Record<string, ReportOutputNode[]> = {};
      for (const child of node.children) {
        mockChildren[child.levelName] = [];
      }
      const rollupResult = node.rollup(mockChildren);
      if (rollupResult && typeof rollupResult === "object") {
        const undeclared = Object.keys(rollupResult).filter(
          (k) => !declaredNames.has(k),
        );
        for (const key of undeclared) {
          issues.push({
            path: `${path}.rollup`,
            message: `key "${key}" not declared in columns[] on level "${node.levelName}"`,
          });
        }
      }
    } catch {
      // Rollup function threw with empty input — can't check statically
    }
  }

  // 3. Footer keys vs columns
  if (node.footer) {
    for (const footer of node.footer) {
      try {
        const footerResult = footer.compute([]);
        if (footerResult && typeof footerResult === "object") {
          const undeclared = Object.keys(footerResult).filter(
            (k) => !declaredNames.has(k),
          );
          for (const key of undeclared) {
            issues.push({
              path: `${path}.footer["${footer.label}"]`,
              message: `key "${key}" not declared in columns[] on level "${node.levelName}"`,
            });
          }
        }
      } catch {
        // Footer compute threw with empty input — can't check statically
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      walkTree(child, def, issues, `${path}.${child.levelName}`);
    }
  }
}

// ---------------------------------------------------------------------------
// DB-aware SQL validation: verify source queries via query planner
// ---------------------------------------------------------------------------
//
// For every source query in the report, we ask PostgreSQL's query planner to
// validate it — without needing valid parameter values or actual table data.
// We do this by replacing all $name bind variables with NULL, wrapping in a
// LIMIT 0 subquery, and executing. PostgreSQL plans (but fetches zero rows),
// catching syntax errors, missing tables, and parameter type inference failures.
//
// NOTE: This check previously also flagged undeclared SQL columns on transform
// nodes (columns returned by SQL but not in columns[]). That check was removed
// because the engine now preserves raw SQL rows via __rawRow and exposes them
// to transforms via context.rawRows and to display functions. Undeclared columns
// are no longer dropped before transforms/display can access them.
// ---------------------------------------------------------------------------

/**
 * SQL interface expected by checkReportSqlColumns.
 *
 * Must return result arrays with a `.columns` property containing column
 * metadata. The real postgres.js driver attaches this automatically.
 * In tests, PGlite's `result.fields` must be adapted to this shape.
 */
export interface CheckSql {
  unsafe(
    query: string,
    params?: unknown[],
  ): Promise<any[] & { columns: { name: string }[] }>;
}

/**
 * Discover column names returned by a source query without fetching any data.
 *
 * Technique: replace all $name bind variables with NULL, wrap in a LIMIT 0
 * subquery, and execute. PostgreSQL plans the query and returns column
 * metadata even though zero rows are fetched. This works even when:
 *  - The referenced tables are empty
 *  - The bind variable values would normally filter out all rows
 *  - The query uses complex joins, CTEs, or aggregations
 *
 * It may fail if the SQL has syntax errors or references nonexistent tables,
 * which is caught and reported as an issue by the caller.
 */
async function discoverSqlColumns(
  sql: CheckSql,
  sourceQuery: string,
): Promise<string[]> {
  const bindVars = extractBindVariables(sourceQuery);

  // Replace every bind variable with NULL. The actual values don't matter
  // because LIMIT 0 means no rows are evaluated — we only need PostgreSQL
  // to parse and plan the query to discover the output column names.
  const nullValues: Record<string, unknown> = {};
  for (const v of bindVars) {
    nullValues[v] = null;
  }
  const { sql: processedSql, values } = buildPositionalQuery(
    sourceQuery,
    bindVars,
    nullValues,
  );

  const wrapped = `SELECT * FROM (${processedSql}) AS _t LIMIT 0`;
  const result = await sql.unsafe(wrapped, values);
  return result.columns.map((c: { name: string }) => c.name);
}

/**
 * Validate report SQL sources and check column declarations.
 *
 * Performs two phases:
 *
 *  1. **Planning validation** — every source query is sent to PostgreSQL's
 *     query planner (via LIMIT 0 + NULL parameters). This catches syntax
 *     errors, missing tables, and parameter type inference failures (e.g.
 *     `date_trunc($1, ...)` or `$2 IS NULL` without type context).
 *
 * Requires a live database connection. Gracefully handles planning
 * errors by reporting them as issues rather than crashing.
 */
export async function checkReportSqlColumns(
  sql: CheckSql,
  def: ReportDefinition,
): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];

  // Validate ALL source queries can be planned by PostgreSQL.
  // This catches errors that would only surface at runtime, like parameter
  // type inference failures (e.g. `$param IS NULL` combined with casts).
  for (const [sourceName, source] of Object.entries(def.sources)) {
    try {
      await discoverSqlColumns(sql, source.query);
    } catch (err: any) {
      issues.push({
        path: sourceName,
        message:
          `SQL planning failed for source "${sourceName}": ${err.message}`,
      });
    }
  }

  return issues;
}
