/**
 * CLI Route Table — maps CLI command patterns to HTTP API endpoints.
 *
 * Each route defines:
 * - The CLI segments users type (verb-first: fixed keywords before positional params)
 * - The HTTP method + path template
 * - How to build the request body / query params from CLI flags
 * - How to extract tabular data from the API response for --output-format table
 *
 * Commander.js registers these routes as a command hierarchy.
 * The action handler substitutes positional params into the URL and calls httpRequest().
 */
import { z } from "zod";
import { Command } from "commander";

// ── Route Definition ────────────────────────────────────────────────────────

export interface CliRoute {
  /** CLI segments in verb-first order.
   *  Fixed keywords come before positional params (tokens starting with ":"). */
  pattern: string[];
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL path template, e.g. "/meta/tables/:name/indexes" */
  path: string;
  /** Names of positional params in pattern order */
  params: string[];
  /** Zod schema for --input-body-json validation (optional) */
  inputSchema?: z.ZodType;
  /** Flag name whose value is parsed as JSON and used as POST body */
  bodyField?: string;
  /** Flags that become URL query params (for GET requests) */
  queryFlags?: string[];
  /** Map positional args (after the pattern) to body fields. */
  positionalArgs?: { field: string }[];
  /** Whether this command mutates data */
  mutating?: boolean;

  /**
   * Maps CLI flag names to request body field names.
   *
   * CLI users type --db <url>, but the API schema may expect
   * database_path. The flagMap bridges this: { db: "database_path" } renames
   * the flag before the body is assembled.
   */
  flagMap?: Record<string, string>;

  /** Extract rows from the API response for --output-format table rendering */
  extractData: (res: any) => Record<string, unknown>[];
  /** Optional header text printed before the table in --output-format table mode */
  formatHeader?: (res: any, params: Record<string, string>) => string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Flatten a TableSchema into a summary row for the table listing. */
function tableListRow(t: any) {
  return {
    name: t.name,
    label: t.label,
    columns: t.columns?.length ?? 0,
    source: t.source,
    rowCount: t.rowCount ?? "",
  };
}

/** Flatten columns for single-table describe output. */
function tableDescribeRows(res: any) {
  if (!res.columns) return [res];
  return res.columns.map((col: any) => ({
    column: col.name,
    type: col.dataType ?? "",
    notNull: col.notNull ? "YES" : "",
    pk: col.primary ? "YES" : "",
    fk: col.foreignKey ? `→ ${col.foreignKey.table}.${col.foreignKey.column}` : "",
    default: col.hasDefault ? "YES" : "",
  }));
}

// ── Route Table ─────────────────────────────────────────────────────────────
//
// Patterns are verb-first: all fixed keywords precede positional params.
// This lets Commander.js build a static command hierarchy for routing,
// help generation, and missing-argument validation.

export const ROUTES: CliRoute[] = [
  // ── /meta ──────────────────────────────────────────────────────────────
  {
    pattern: ["meta", "tables"],
    description: "List all tables with schema metadata and row counts",
    method: "GET",
    path: "/api/meta/tables",
    params: [],
    extractData: (res) => (res.tables ?? []).map(tableListRow),
  },
  {
    pattern: ["meta", "tables", "show", ":name"],
    description: "Describe single table schema",
    method: "GET",
    path: "/api/meta/tables/:name",
    params: ["name"],
    extractData: tableDescribeRows,
    formatHeader: (res) => res.name ? `Table: ${res.name} (${res.label})` : undefined,
  },
  {
    pattern: ["meta", "tables", "indexes", ":name"],
    description: "Show indexes on a table",
    method: "GET",
    path: "/api/meta/tables/:name/indexes",
    params: ["name"],
    extractData: (res) => res.data ?? res ?? [],
  },
  {
    pattern: ["meta", "tables", "sample", ":name"],
    description: "Show sample rows from a table",
    method: "GET",
    path: "/api/meta/tables/:name/sample",
    params: ["name"],
    queryFlags: ["limit", "fields"],
    extractData: (res) => res.data ?? res ?? [],
  },
  {
    pattern: ["meta", "tables", "update", ":name"],
    description: "Update table properties (label, row_label_columns[], immutable, name)",
    method: "PATCH",
    path: "/api/meta/tables/:name",
    params: ["name"],
    bodyField: "data",
    mutating: true,
    inputSchema: z.object({
      name: z.string().optional().describe("New table name (rename)"),
      label: z.string().optional().describe("Display label"),
      row_label_columns: z.array(z.string()).min(1).optional().describe("Columns whose values build a row's label in FK dropdowns and lookups (concatenated with a space)"),
      immutable: z.boolean().optional().describe("Prevent updates and deletes"),
      position: z.number().optional().describe("Sort position in sidebar"),
    }),
    extractData: (res) => [res],
  },
  {
    pattern: ["meta", "tables", "drop", ":name"],
    description: "Drop a UI-managed table",
    method: "DELETE",
    path: "/api/meta/tables/:name",
    params: ["name"],
    queryFlags: ["confirm"],
    mutating: true,
    extractData: (res) => [res],
  },
  {
    pattern: ["meta", "enums"],
    description: "List all Postgres enums and their allowed values",
    method: "GET",
    path: "/api/meta/enums",
    params: [],
    extractData: (res) => res.data ?? res ?? [],
  },
  {
    pattern: ["meta", "sql"],
    description:
      "Run any SQL statement — reads return rows, writes report row counts",
    method: "POST",
    path: "/api/meta/sql",
    params: [],
    positionalArgs: [{ field: "sql" }],
    mutating: true,
    inputSchema: z.object({
      sql: z.string().describe("SQL statement to run"),
      limit: z
        .number()
        .optional()
        .describe("Cap rows for statements that return rows"),
      dryRun: z
        .boolean()
        .optional()
        .describe("For writes: validate via EXPLAIN QUERY PLAN without executing"),
    }),
    extractData: (res) => (Array.isArray(res) ? res : res.data ?? [res]),
  },
  {
    pattern: ["meta", "schema", "sync"],
    description: "Sync schema files to database (apply migrations)",
    method: "POST",
    path: "/api/meta/schema/sync",
    params: [],
    mutating: true,
    extractData: (res) => [res],
  },
  // ── /tables ────────────────────────────────────────────────────────────
  {
    pattern: ["tables", "list", ":table"],
    description: "List rows from a table (with filters, sort, pagination)",
    method: "GET",
    path: "/api/tables/:table",
    params: ["table"],
    queryFlags: ["limit", "page", "sort", "order"],
    extractData: (res) => res.data ?? [],
    formatHeader: (res) => {
      const m = res.meta;
      return m ? `Page ${m.page}/${m.pages} (${m.total} total rows)` : undefined;
    },
  },
  {
    pattern: ["tables", "get", ":table", ":id"],
    description: "Get a single row by ID",
    method: "GET",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    extractData: (res) => res.data ? [res.data] : [],
  },
  {
    pattern: ["tables", "add-row", ":table"],
    description: "Insert one or more rows into a table",
    method: "POST",
    path: "/api/tables/:table",
    params: ["table"],
    bodyField: "data",
    mutating: true,
    extractData: (res) => {
      const d = res.data;
      return Array.isArray(d) ? d : d ? [d] : [];
    },
  },
  {
    pattern: ["tables", "update", ":table", ":id"],
    description: "Update a row by ID",
    method: "PUT",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    bodyField: "data",
    mutating: true,
    extractData: (res) => res.data ? [res.data] : [],
  },
  {
    pattern: ["tables", "delete", ":table", ":id"],
    description: "Delete a row by ID",
    method: "DELETE",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    mutating: true,
    extractData: (res) => res.data ? [res.data] : [],
  },

  // ── /reports ───────────────────────────────────────────────────────────
  {
    pattern: ["reports"],
    description: "List all report definitions",
    method: "GET",
    path: "/api/reports",
    params: [],
    extractData: (res) =>
      (res.reports ?? []).map((r: any) => ({
        name: r.name,
        label: r.label ?? r.name,
        params: (r.params ?? []).map((p: any) => p.name).join(", "),
      })),
  },
  {
    pattern: ["reports", "show", ":name"],
    description: "Get report metadata and parameters",
    method: "GET",
    path: "/api/reports/:name",
    params: ["name"],
    extractData: (res) => [res],
  },
  {
    pattern: ["reports", "run", ":name"],
    description: "Execute a report with parameters",
    method: "GET",
    path: "/api/reports/:name/results",
    params: ["name"],
    queryFlags: ["*"],
    extractData: (res) => {
      if (res.nodes) return res.nodes;
      if (Array.isArray(res)) return res;
      return [res];
    },
  },

];

// ── Commander registration ──────────────────────────────────────────────────

export type RouteActionHandler = (
  route: CliRoute,
  params: Record<string, string>,
  extraPositionals: string[],
) => Promise<void>;

/**
 * Register all CLI routes as Commander subcommands.
 *
 * Builds a command hierarchy from each route's fixed segments, adds
 * positional arguments for URL params and positionalArgs, then wires
 * the action callback through the provided handler.
 *
 * Commander handles routing, required-argument validation, and help
 * generation. The handler receives the matched route, extracted URL
 * params, and any extra positional values (for positionalArgs fields).
 */
export function registerRoutes(
  program: Command,
  routes: CliRoute[],
  handler: RouteActionHandler,
): void {
  for (const route of routes) {
    const fixed: string[] = [];
    const params: string[] = [];
    for (const token of route.pattern) {
      if (token.startsWith(":")) params.push(token.slice(1));
      else fixed.push(token);
    }

    if (fixed.length === 0) continue;

    // Navigate/create command hierarchy for fixed[0..len-2]
    let parent: Command = program;
    for (let i = 0; i < fixed.length - 1; i++) {
      let existing = parent.commands.find((c) => c.name() === fixed[i]);
      if (!existing) {
        existing = parent.command(fixed[i]);
        existing.allowUnknownOption();
        existing.allowExcessArguments(true);
      }
      parent = existing;
    }

    // Create or reuse the leaf command
    const leafName = fixed[fixed.length - 1];
    let cmd = parent.commands.find((c) => c.name() === leafName);
    if (!cmd) {
      cmd = parent.command(leafName);
    }

    cmd.description(route.description);

    // URL params become required arguments
    for (const p of params) {
      cmd.argument(`<${p}>`);
    }

    // positionalArgs become optional arguments (e.g. [sql] for "meta sql")
    if (route.positionalArgs) {
      for (const pa of route.positionalArgs) {
        cmd.argument(`[${pa.field}]`);
      }
    }

    cmd.allowUnknownOption();
    cmd.allowExcessArguments(true);

    // Capture route and params list in closure
    const routeRef = route;
    const paramNames = params;

    cmd.action(async (...actionArgs: any[]) => {
      actionArgs.pop(); // Command instance
      actionArgs.pop(); // Commander-parsed options (unused — we parse flags ourselves)
      const positionalValues = actionArgs as string[];

      // Map declared positional values to route URL params
      const routeParams: Record<string, string> = {};
      for (let i = 0; i < paramNames.length; i++) {
        routeParams[paramNames[i]] = positionalValues[i];
      }

      // Remaining positionals go to positionalArgs mapping in buildRequest
      const extraPositionals = positionalValues.slice(paramNames.length);

      await handler(routeRef, routeParams, extraPositionals);
    });
  }
}
