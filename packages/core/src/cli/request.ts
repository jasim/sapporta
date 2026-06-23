/**
 * Turns CLI arguments into ordinary HTTP requests.
 *
 * Flags in `SYSTEM_FLAGS` configure the CLI itself. They are never sent to the
 * app as query parameters or request body fields, which keeps credentials such
 * as `--api-token` out of application data.
 */
import type { CliRoute } from "./routes.js";
import { formatTable, type OutputFormat } from "./format.js";
import { ErrorCode, OperationError } from "../introspect/types.js";
import { z } from "zod";

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
  allFlags: Record<string, unknown>,
): RequestSpec {
  validateRouteFlags(route, allFlags);

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
    const inputBodyJson = readStringFlag(allFlags, "input-body-json");
    if (inputBodyJson) {
      body = parseJsonFlag(inputBodyJson, "input-body-json");
      if (route.inputSchema) {
        body = parseSchemaBody(route, body);
      }
    } else if (route.bodyField && readStringFlag(allFlags, route.bodyField)) {
      const bodyJson = readStringFlag(allFlags, route.bodyField)!;
      body = parseJsonFlag(bodyJson, route.bodyField);
    } else if (route.inputSchema) {
      const schemaBody: Record<string, unknown> = {};
      if (route.positionalArgs) {
        const positionals = readPositionals(allFlags);
        for (
          let i = 0;
          i < route.positionalArgs.length && i < positionals.length;
          i++
        ) {
          schemaBody[route.positionalArgs[i].field] = positionals[i];
        }
      }
      addBodyFlags(route, allFlags, schemaBody);
      validateRequiredBodyFields(route, schemaBody);
      if (Object.keys(schemaBody).length > 0) {
        body = parseSchemaBody(route, schemaBody);
      }
    }
  }

  const queryParams: Record<string, string> = {};
  if (route.queryFlags) {
    if (route.queryFlags.includes("*")) {
      for (const [key, value] of Object.entries(allFlags)) {
        if (SYSTEM_FLAGS.has(key)) continue;
        if (typeof value === "string") queryParams[key] = value;
      }
    } else {
      for (const flag of route.queryFlags) {
        const value = readStringFlag(allFlags, flag);
        if (value) queryParams[flag] = value;
      }
      if (route.allowFilterFlags) {
        for (const [key, value] of Object.entries(allFlags)) {
          if (key.startsWith("filter[") && typeof value === "string") {
            queryParams[key] = value;
          }
        }
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

function validateRouteFlags(
  route: CliRoute,
  allFlags: Record<string, unknown>,
): void {
  const acceptsAnyQueryFlag = route.queryFlags?.includes("*") ?? false;
  const allowedFlags = new Set([
    ...SYSTEM_FLAGS,
    ...(route.queryFlags ?? []),
    ...(route.bodyField ? [route.bodyField] : []),
    ...Object.keys(route.bodyFlags ?? {}),
  ]);

  for (const key of Object.keys(allFlags)) {
    if (key === "_") continue;
    if (allowedFlags.has(key)) continue;
    if (acceptsAnyQueryFlag) continue;
    if (route.allowFilterFlags && key.startsWith("filter[")) continue;
    throw new OperationError(
      `Unknown option --${key} for command ${route.pattern.join(" ")}`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
}

function addBodyFlags(
  route: CliRoute,
  allFlags: Record<string, unknown>,
  schemaBody: Record<string, unknown>,
): void {
  if (!route.bodyFlags) return;
  for (const [flagName, bodyFlag] of Object.entries(route.bodyFlags)) {
    if (!(flagName in allFlags)) continue;
    const raw = allFlags[flagName];
    if (typeof raw !== "string") {
      throw new OperationError(
        `--${flagName} must be provided as a string value`,
        ErrorCode.VALIDATION_FAILED,
      );
    }
    const field = bodyFlag.field ?? flagName;
    schemaBody[field] = bodyFlag.parse
      ? bodyFlag.parse(raw, flagName)
      : raw;
  }
}

function readStringFlag(
  allFlags: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = allFlags[key];
  return typeof value === "string" ? value : undefined;
}

function readPositionals(allFlags: Record<string, unknown>): string[] {
  const value = allFlags._;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseJsonFlag(raw: string, flagName: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OperationError(
      `Invalid JSON for --${flagName}`,
      ErrorCode.INVALID_JSON,
    );
  }
}

function parseSchemaBody(route: CliRoute, body: unknown): unknown {
  if (!route.inputSchema) return body;
  try {
    return route.inputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new OperationError(
        `Invalid command input: ${err.issues.map((issue) => issue.message).join("; ")}`,
        ErrorCode.VALIDATION_FAILED,
      );
    }
    throw err;
  }
}

function validateRequiredBodyFields(route: CliRoute, body: unknown): void {
  if (!route.requiredBodyFields || route.requiredBodyFields.length === 0) {
    return;
  }
  const record =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  for (const field of route.requiredBodyFields) {
    if (!(field in record)) {
      throw new OperationError(
        `Missing required argument: ${field}`,
        ErrorCode.MISSING_ARGUMENT,
      );
    }
  }
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
