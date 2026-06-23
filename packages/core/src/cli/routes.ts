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
import { ErrorCode, OperationError } from "../introspect/types.js";
import { parseOptionalBoundedInteger } from "@sapporta/shared/validation";

// ── Route Definition ────────────────────────────────────────────────────────

export type CliBodyFlagParser = (raw: string, flagName: string) => unknown;

export interface CliBodyFlag {
  /** Request body field name. Defaults to the CLI flag name. */
  field?: string;
  /** Parse the CLI string into the request body's typed value. */
  parse?: CliBodyFlagParser;
}

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
  /** Flags parsed into request body fields for schema-built commands. */
  bodyFlags?: Record<string, CliBodyFlag>;
  /** Accept bracketed filter flags such as `filter[name][eq]`. */
  allowFilterFlags?: boolean;
  /** Body fields that must be present before sending an HTTP request. */
  requiredBodyFields?: string[];
  /** Map positional args (after the pattern) to body fields. */
  positionalArgs?: { field: string }[];
  /** Whether this command mutates data */
  mutating?: boolean;

  /** Extract rows from the API response for --output-format table rendering */
  extractData: (res: unknown) => Record<string, unknown>[];
  /** Optional header text printed before the table in --output-format table mode */
  formatHeader?: (
    res: unknown,
    params: Record<string, string>,
  ) => string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Flatten a TableSchema into a summary row for the table listing. */
function tableListRow(t: Record<string, unknown>) {
  return {
    name: t.name ?? "",
    label: t.label ?? "",
    columns: Array.isArray(t.columns) ? t.columns.length : 0,
    source: t.source ?? "",
    rowCount: t.rowCount ?? "",
  };
}

/** Flatten columns for single-table describe output. */
function tableDescribeRows(res: unknown): Record<string, unknown>[] {
  if (!isRecord(res)) return [];
  if (!Array.isArray(res.columns)) return [res];
  return res.columns.filter(isRecord).map((col) => {
    const foreignKey = isRecord(col.foreignKey) ? col.foreignKey : null;
    return {
      column: col.name,
      type: col.dataType ?? "",
      notNull: col.notNull ? "YES" : "",
      pk: col.primary ? "YES" : "",
      fk: foreignKey
        ? `→ ${String(foreignKey.table)}.${String(foreignKey.column)}`
        : "",
      default: col.hasDefault ? "YES" : "",
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const item = value[key];
  return isRecord(item) ? item : null;
}

function readRecordArray(
  value: unknown,
  key: string,
): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  return recordArray(value[key]);
}

// ── Route Table ─────────────────────────────────────────────────────────────
//
// Patterns are verb-first: all fixed keywords precede positional params.
// This lets Commander.js build a static command hierarchy for routing,
// help generation, and missing-argument validation.

export const ROUTES: CliRoute[] = [
  // ── Table definitions ─────────────────────────────────────────────────
  {
    pattern: ["tables"],
    description: "List table definitions",
    method: "GET",
    path: "/api/meta/tables",
    params: [],
    queryFlags: ["detail"],
    extractData: (res) => readRecordArray(res, "tables").map(tableListRow),
  },
  {
    pattern: ["tables", "show", ":table"],
    description: "Show table schema",
    method: "GET",
    path: "/api/meta/tables/:table",
    params: ["table"],
    extractData: tableDescribeRows,
    formatHeader: (res) => {
      if (!isRecord(res) || typeof res.name !== "string") return undefined;
      return `Table: ${res.name} (${String(res.label ?? "")})`;
    },
  },
  {
    pattern: ["tables", "indexes", ":table"],
    description: "Show table indexes",
    method: "GET",
    path: "/api/meta/tables/:table/indexes",
    params: ["table"],
    extractData: (res) => {
      const data = readRecordArray(res, "data");
      return data.length > 0 ? data : recordArray(res);
    },
  },
  {
    pattern: ["tables", "sample", ":table"],
    description: "Show sample rows for inspection",
    method: "GET",
    path: "/api/meta/tables/:table/sample",
    params: ["table"],
    queryFlags: ["limit", "fields"],
    extractData: (res) => {
      const data = readRecordArray(res, "data");
      return data.length > 0 ? data : recordArray(res);
    },
  },
  // ── Row data ──────────────────────────────────────────────────────────
  {
    pattern: ["rows", ":table"],
    description: "List rows from a table",
    method: "GET",
    path: "/api/tables/:table",
    params: ["table"],
    queryFlags: ["limit", "page", "sort", "q"],
    allowFilterFlags: true,
    extractData: (res) => readRecordArray(res, "data"),
    formatHeader: (res) => {
      if (!isRecord(res) || !isRecord(res.meta)) return undefined;
      const m = res.meta;
      return `Page ${String(m.page)}/${String(m.pages)} (${String(m.total)} total rows)`;
    },
  },
  {
    pattern: ["rows", "get", ":table", ":id"],
    description: "Get a single row by ID",
    method: "GET",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    extractData: (res) => {
      const data = readRecord(res, "data");
      return data ? [data] : [];
    },
  },
  {
    pattern: ["rows", "insert", ":table"],
    description: "Insert one or more rows into a table",
    method: "POST",
    path: "/api/tables/:table",
    params: ["table"],
    bodyField: "data",
    mutating: true,
    extractData: (res) => {
      if (!isRecord(res)) return [];
      if (Array.isArray(res.data)) return recordArray(res.data);
      return isRecord(res.data) ? [res.data] : [];
    },
  },
  {
    pattern: ["rows", "update", ":table", ":id"],
    description: "Update a row by ID",
    method: "PUT",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    bodyField: "data",
    mutating: true,
    extractData: (res) => {
      const data = readRecord(res, "data");
      return data ? [data] : [];
    },
  },
  {
    pattern: ["rows", "delete", ":table", ":id"],
    description: "Delete a row by ID",
    method: "DELETE",
    path: "/api/tables/:table/:id",
    params: ["table", "id"],
    mutating: true,
    extractData: (res) => {
      const data = readRecord(res, "data");
      return data ? [data] : [];
    },
  },

  // ── Database ──────────────────────────────────────────────────────────
  {
    pattern: ["db", "exec-sql"],
    description: "Execute raw SQL; reads return rows, writes report row counts",
    method: "POST",
    path: "/api/meta/sql",
    params: [],
    positionalArgs: [{ field: "sql" }],
    mutating: true,
    inputSchema: z.object({
      sql: z.string().describe("SQL statement to run"),
      params: z
        .array(z.unknown())
        .optional()
        .describe("Positional values bound to placeholders in the SQL"),
      limit: z
        .number()
        .optional()
        .describe("Cap rows for statements that return rows"),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "For writes: validate via EXPLAIN QUERY PLAN without executing",
        ),
    }),
    bodyFlags: {
      limit: { parse: parseSqlLimitFlag },
      params: { parse: parseParamsFlag },
      "dry-run": { field: "dryRun", parse: parseBooleanFlag },
    },
    requiredBodyFields: ["sql"],
    extractData: (res) => {
      if (Array.isArray(res)) return recordArray(res);
      const data = readRecordArray(res, "data");
      if (data.length > 0) return data;
      return isRecord(res) ? [res] : [];
    },
  },
];

function parseSqlLimitFlag(raw: string): number | undefined {
  return parseOptionalBoundedInteger(raw, {
    name: "limit",
    min: 1,
    max: 1000,
    makeError: (message) => new OperationError(message, ErrorCode.BAD_LIMIT),
  });
}

function parseBooleanFlag(raw: string, flagName: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new OperationError(
    `--${flagName} must be true or false, got ${JSON.stringify(raw)}`,
    ErrorCode.VALIDATION_FAILED,
  );
}

function parseParamsFlag(raw: string, flagName: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new OperationError(
      `Invalid JSON for --${flagName}`,
      ErrorCode.INVALID_JSON,
    );
  }
  if (Array.isArray(parsed)) return parsed;
  throw new OperationError(
    `--${flagName} must be a JSON array`,
    ErrorCode.VALIDATION_FAILED,
  );
}

// ── Commander registration ──────────────────────────────────────────────────

const COMMAND_GROUP_DESCRIPTIONS: Record<string, string> = {
  schema: "Schema operations",
  db: "Database operations",
};

export type RouteActionHandler = (
  route: CliRoute,
  params: Record<string, string>,
  extraPositionals: string[],
) => Promise<void>;

type CliCommand = {
  commands: readonly CliCommand[];
  name(): string;
  command(name: string): CliCommand;
  description(description: string): CliCommand;
  allowUnknownOption(): CliCommand;
  allowExcessArguments(allow: boolean): CliCommand;
  argument(name: string): CliCommand;
  action(handler: (...args: unknown[]) => void | Promise<void>): CliCommand;
};

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
  program: CliCommand,
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
    let parent: CliCommand = program;
    for (let i = 0; i < fixed.length - 1; i++) {
      let existing = parent.commands.find((c) => c.name() === fixed[i]);
      if (!existing) {
        existing = parent.command(fixed[i]);
        const description = COMMAND_GROUP_DESCRIPTIONS[fixed[i]];
        if (description) existing.description(description);
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

    // positionalArgs become optional arguments (e.g. [sql] for "db exec-sql")
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

    cmd.action(async (...actionArgs: unknown[]) => {
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
