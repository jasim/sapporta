/**
 * Pure primitives for querying an OpenAPI document.
 *
 * Everything except `fetchOpenApiSpec` is pure: it takes a spec and returns
 * data. This keeps the hard logic (ref resolution, matching, extraction)
 * unit-testable without any I/O, so `describe.ts` can stay a thin adapter.
 */

import { httpRequest } from "./http-client.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export type OpenApiDoc = {
  openapi: string;
  paths: Record<string, Record<string, any>>;
  components?: { schemas?: Record<string, any> };
};

export type EndpointSummary = {
  method: HttpMethod;
  path: string;
  summary?: string;
  tags?: string[];
};

export type EndpointDetail = EndpointSummary & {
  description?: string;
  parameters: any[];
  requestBody: { contentType: string; schema: any } | null;
  responses: Record<
    string,
    {
      description?: string;
      contentType?: string;
      schema: any;
    }
  >;
};

export type FindResult =
  | { kind: "hit"; endpoint: EndpointDetail }
  | { kind: "ambiguous"; candidates: EndpointSummary[] }
  | { kind: "miss"; suggestions: EndpointSummary[] };

/**
 * Thin I/O wrapper around httpRequest. ECONNREFUSED already surfaces as
 * the friendly "Is the server running?" error from http-client.
 */
export async function fetchOpenApiSpec(baseUrl: string): Promise<OpenApiDoc> {
  const res = await httpRequest(baseUrl, "GET", "/api/openapi.json");
  return res.data as OpenApiDoc;
}

/** Flatten spec.paths into a sorted list of summaries. */
export function listEndpoints(spec: OpenApiDoc): EndpointSummary[] {
  const out: EndpointSummary[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as any)[method.toLowerCase()];
      if (!op || typeof op !== "object") continue;
      const summary: EndpointSummary = { method, path };
      if (typeof op.summary === "string") summary.summary = op.summary;
      if (Array.isArray(op.tags)) summary.tags = op.tags;
      out.push(summary);
    }
  }
  out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return out;
}

/**
 * Deep-clone and inline any node with `$ref: "#/components/..."`.
 * Cycles leave the original `$ref` string in place. Unknown or external
 * refs are left as-is.
 */
export function resolveRefs<T>(node: T, spec: OpenApiDoc): T {
  const seen = new Set<string>();
  const walk = (n: any): any => {
    if (n === null || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(walk);
    if (typeof n.$ref === "string") {
      const ref: string = n.$ref;
      if (!ref.startsWith("#/components/")) return { ...n };
      if (seen.has(ref)) return { $ref: ref };
      const target = lookupRef(spec, ref);
      if (target === undefined) return { $ref: ref };
      seen.add(ref);
      const resolved = walk(target);
      seen.delete(ref);
      return resolved;
    }
    const out: any = {};
    for (const [k, v] of Object.entries(n)) out[k] = walk(v);
    return out;
  };
  return walk(node);
}

function lookupRef(spec: OpenApiDoc, ref: string): any {
  const parts = ref.slice(2).split("/");
  let cur: any = spec;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Extract one operation with all `$ref`s inlined. Throws if the method/path
 * combination does not exist — callers should use `findEndpoint` first.
 */
export function getEndpointDetail(
  spec: OpenApiDoc,
  method: HttpMethod,
  path: string,
): EndpointDetail {
  const pathItem = spec.paths?.[path];
  const op = pathItem?.[method.toLowerCase()];
  if (!op) {
    throw new Error(`Operation not found: ${method} ${path}`);
  }

  const parameters = Array.isArray(op.parameters)
    ? (resolveRefs(op.parameters, spec) as any[])
    : [];

  let requestBody: EndpointDetail["requestBody"] = null;
  if (op.requestBody) {
    const body = resolveRefs(op.requestBody, spec) as any;
    const content = body.content ?? {};
    const contentType = Object.keys(content)[0];
    if (contentType) {
      requestBody = {
        contentType,
        schema: content[contentType]?.schema ?? null,
      };
    }
  }

  const responses: EndpointDetail["responses"] = {};
  for (const [status, raw] of Object.entries(op.responses ?? {})) {
    const r = resolveRefs(raw, spec) as any;
    const content = r?.content ?? {};
    const contentType = Object.keys(content)[0];
    responses[status] = {
      description: r?.description,
      contentType,
      schema: contentType ? content[contentType]?.schema ?? null : null,
    };
  }

  const detail: EndpointDetail = {
    method,
    path,
    parameters,
    requestBody,
    responses,
  };
  if (typeof op.summary === "string") detail.summary = op.summary;
  if (Array.isArray(op.tags)) detail.tags = op.tags;
  if (typeof op.description === "string") detail.description = op.description;
  return detail;
}

/**
 * Every Sapporta route is mounted under `/api/`. Accept both the canonical
 * form (`/api/foo`) and the prefix-less shorthand (`/foo`) so describe
 * tolerates either input and always resolves to the canonical path.
 */
function candidatePaths(path: string): string[] {
  if (path.startsWith("/api/") || path === "/api") return [path];
  if (path.startsWith("/")) return [path, `/api${path}`];
  return [path];
}

/**
 * Parse a user target into a discriminated result.
 *
 * Forms:
 *   1. "METHOD /path" — exact match, returns hit.
 *   2. "/path"        — any method at that exact path. One → hit, many → ambiguous.
 *   3. freeform       — never a hit; always produces miss.suggestions.
 *
 * For forms 1 and 2, a prefix-less path (e.g. `/accounts`) transparently
 * falls back to the `/api/`-prefixed canonical form (`/api/accounts`) when
 * no literal match exists.
 */
export function findEndpoint(spec: OpenApiDoc, target: string): FindResult {
  const trimmed = target.trim();
  const endpoints = listEndpoints(spec);

  const whitespaceSplit = trimmed.match(/^(\S+)\s+(\S+)$/);
  if (whitespaceSplit) {
    const maybeMethod = whitespaceSplit[1].toUpperCase();
    const rawPath = whitespaceSplit[2];
    if ((HTTP_METHODS as string[]).includes(maybeMethod)) {
      const method = maybeMethod as HttpMethod;
      for (const path of candidatePaths(rawPath)) {
        if (spec.paths?.[path]?.[method.toLowerCase()]) {
          return { kind: "hit", endpoint: getEndpointDetail(spec, method, path) };
        }
      }
      return { kind: "miss", suggestions: suggestionsFor(endpoints, trimmed) };
    }
  }

  if (trimmed.startsWith("/") && !/\s/.test(trimmed)) {
    for (const path of candidatePaths(trimmed)) {
      const matches = endpoints.filter((e) => e.path === path);
      if (matches.length === 1) {
        return {
          kind: "hit",
          endpoint: getEndpointDetail(spec, matches[0].method, matches[0].path),
        };
      }
      if (matches.length > 1) {
        return { kind: "ambiguous", candidates: matches };
      }
    }
  }

  return { kind: "miss", suggestions: suggestionsFor(endpoints, trimmed) };
}

function suggestionsFor(
  endpoints: EndpointSummary[],
  target: string,
): EndpointSummary[] {
  const q = target.toLowerCase();
  const seen = new Set<string>();
  const out: EndpointSummary[] = [];
  // Summary matches first — agents type intent ("create invoice") more
  // often than paths.
  for (const e of endpoints) {
    if (e.summary && e.summary.toLowerCase().includes(q)) {
      const key = `${e.method} ${e.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  for (const e of endpoints) {
    if (e.path.toLowerCase().includes(q)) {
      const key = `${e.method} ${e.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  }
  return out.slice(0, 8);
}
