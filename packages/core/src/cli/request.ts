/**
 * Turns CLI arguments into ordinary HTTP requests.
 *
 * Flags in `SYSTEM_FLAGS` configure the CLI itself. They are never sent to the
 * app as query parameters or request body fields, which keeps credentials such
 * as `--api-token` out of application data.
 */
import type { CliRoute } from "./routes.js";
import { formatTable, type OutputFormat } from "./format.js";

// ---------------------------------------------------------------------------
// System flags — excluded from body/query param building
// ---------------------------------------------------------------------------

/** Flags consumed by the CLI itself, never forwarded to the app API. */
const SYSTEM_FLAGS = new Set([
  "_",
  "output-format",
  "input-body-json",
  "api-url",
  "api-token",
  "sapporta-project-dir",
]);

// ---------------------------------------------------------------------------
// CLI arguments -> HTTP request
// ---------------------------------------------------------------------------

export interface RequestSpec {
  method: string;
  urlPath: string;
  body?: unknown;
  queryParams?: Record<string, string>;
}

/**
 * Build the request for one CLI route.
 *
 * Route parameters become path segments. Route-specific flags become query
 * parameters or body fields. CLI settings such as output format, deployment
 * URL, and token stay local to the command.
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
  if (
    route.method === "POST" ||
    route.method === "PUT" ||
    route.method === "PATCH"
  ) {
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
          for (
            let i = 0;
            i < route.positionalArgs.length && i < positionals.length;
            i++
          ) {
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
// HTTP response -> CLI output
// ---------------------------------------------------------------------------

/**
 * Render an HTTP result to stdout/stderr.
 * Returns the exit code (0 for success, 1 for error).
 */
export function renderResult(
  route: CliRoute,
  params: Record<string, string>,
  result: { status: number; data: unknown },
  format: OutputFormat,
): number {
  if (result.status >= 400) {
    const data = readResponseData(result.data);
    const errMsg = data?.error ?? `HTTP ${result.status}`;
    if (format === "json") {
      console.log(JSON.stringify(result.data));
    } else {
      console.error(`Error: ${errMsg}`);
      if (data?.details) {
        console.error(JSON.stringify(data.details, null, 2));
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

function readResponseData(
  data: unknown,
): { error?: string; details?: unknown } | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  return {
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...("details" in record ? { details: record.details } : {}),
  };
}
