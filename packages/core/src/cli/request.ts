/**
 * Request building and response rendering for CLI → API bridge.
 *
 * Side-effect-free — safe to import from other packages.
 */
import type { CliRoute } from "./routes.js";
import { formatTable, type OutputFormat } from "./format.js";

// ---------------------------------------------------------------------------
// System flags — excluded from body/query param building
// ---------------------------------------------------------------------------

/** Flags consumed by the CLI framework, never forwarded to the API. */
const SYSTEM_FLAGS = new Set([
  "_",
  "output-format",
  "input-body-json",
  "api-url",
  "sapporta-project-dir",
]);

// ---------------------------------------------------------------------------
// Request building (pure, testable)
// ---------------------------------------------------------------------------

export interface RequestSpec {
  method: string;
  urlPath: string;
  body?: unknown;
  queryParams?: Record<string, string>;
}

/**
 * Build an HTTP request spec from a matched route and parsed flags.
 * Pure function — no I/O, fully testable.
 */
export function buildRequest(
  route: CliRoute,
  params: Record<string, string>,
  allFlags: Record<string, any>,
): RequestSpec {
  let urlPath = route.path;
  for (const [key, value] of Object.entries(params)) {
    urlPath = urlPath.replace(`:${key}`, encodeURIComponent(value));
  }

  let body: unknown | undefined;
  if (route.method === "POST" || route.method === "PUT" || route.method === "PATCH") {
    if (allFlags["input-body-json"]) {
      body = JSON.parse(allFlags["input-body-json"]);
      if (route.inputSchema) {
        body = route.inputSchema.parse(body);
      }
    } else if (route.bodyField && allFlags[route.bodyField]) {
      body = JSON.parse(allFlags[route.bodyField]);
    } else if (route.inputSchema) {
      const schemaBody: Record<string, unknown> = {};
      if (route.positionalArgs) {
        const positionals = allFlags._ as unknown as string[];
        if (positionals) {
          for (let i = 0; i < route.positionalArgs.length && i < positionals.length; i++) {
            schemaBody[route.positionalArgs[i].field] = positionals[i];
          }
        }
      }
      for (const [key, value] of Object.entries(allFlags)) {
        if (SYSTEM_FLAGS.has(key) || key === "dry-run") continue;
        schemaBody[key] = value;
      }
      if (allFlags["dry-run"]) {
        schemaBody.dryRun = true;
      }
      if (route.flagMap) {
        for (const [cliKey, bodyKey] of Object.entries(route.flagMap)) {
          if (cliKey in schemaBody) {
            schemaBody[bodyKey] = schemaBody[cliKey];
            delete schemaBody[cliKey];
          }
        }
      }
      if (Object.keys(schemaBody).length > 0) {
        body = route.inputSchema.parse(schemaBody);
      }
    }
  }

  const queryParams: Record<string, string> = {};
  if (route.queryFlags) {
    if (route.queryFlags.includes("*")) {
      for (const [key, value] of Object.entries(allFlags)) {
        if (SYSTEM_FLAGS.has(key)) continue;
        queryParams[key] = value;
      }
    } else {
      for (const flag of route.queryFlags) {
        if (allFlags[flag]) queryParams[flag] = allFlags[flag];
      }
    }
  }

  return {
    method: route.method,
    urlPath,
    body,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  };
}

// ---------------------------------------------------------------------------
// Response rendering (I/O shell)
// ---------------------------------------------------------------------------

/**
 * Render an HTTP result to stdout/stderr.
 * Returns the exit code (0 for success, 1 for error).
 */
export function renderResult(
  route: CliRoute,
  params: Record<string, string>,
  result: { status: number; data: any },
  format: OutputFormat,
): number {
  if (result.status >= 400) {
    const errMsg = result.data?.error ?? `HTTP ${result.status}`;
    if (format === "json") {
      console.log(JSON.stringify(result.data));
    } else {
      console.error(`Error: ${errMsg}`);
      if (result.data?.details) {
        console.error(JSON.stringify(result.data.details, null, 2));
      }
    }
    return 1;
  }

  if (format === "json") {
    console.log(JSON.stringify(result.data));
  } else {
    if (route.formatHeader) {
      const header = route.formatHeader(result.data, params);
      if (header) console.log(header);
    }
    const rows = route.extractData(result.data);
    if (rows.length > 0) {
      console.log(formatTable(rows));
    } else {
      console.log("(empty)");
    }
  }

  return 0;
}
