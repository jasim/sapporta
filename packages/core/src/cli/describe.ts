/**
 * `sapporta describe` reads the live app contract from `/api/openapi.json`.
 *
 * Protected apps require the same token for discovery that they require for
 * data access. This lets an agent discover exactly the endpoints available in
 * the selected deployment and workspace without browser login or implicit
 * profiles.
 */

import type { OperationResult } from "../introspect/types.js";
import {
  fetchOpenApiSpec,
  listEndpoints,
  findEndpoint,
  type EndpointSummary,
  type EndpointDetail,
} from "./openapi-spec.js";

export async function describeAll(
  baseUrl: string,
  authToken?: string,
): Promise<OperationResult> {
  const spec = await fetchOpenApiSpec(baseUrl, authToken);
  const endpoints = listEndpoints(spec);
  return {
    ok: true,
    data: endpoints as unknown as Record<string, unknown>[],
    meta: { tableOutputHandled: true, message: formatEndpointList(endpoints) },
  };
}

export async function describeOne(
  target: string,
  baseUrl: string,
  authToken?: string,
): Promise<OperationResult> {
  const spec = await fetchOpenApiSpec(baseUrl, authToken);
  const result = findEndpoint(spec, target);

  if (result.kind === "hit") {
    return {
      ok: true,
      data: [result.endpoint as unknown as Record<string, unknown>],
      meta: {
        tableOutputHandled: true,
        message: formatEndpointDetail(result.endpoint),
      },
    };
  }

  if (result.kind === "ambiguous") {
    const lines = result.candidates.map((c) => `  ${c.method} ${c.path}`);
    return {
      ok: false,
      error: `Ambiguous target "${target}". Candidates:\n${lines.join("\n")}`,
      code: "MISSING_ARGUMENT",
    };
  }

  const suggestLines = result.suggestions.map((s) => `  ${s.method} ${s.path}`);
  const didYouMean =
    suggestLines.length > 0
      ? `\n\nDid you mean:\n${suggestLines.join("\n")}`
      : "";
  return {
    ok: false,
    error: `No endpoint matches "${target}".${didYouMean}`,
    code: "MISSING_ARGUMENT",
  };
}

// ── Rendering ────────────────────────────────────────────────────────────

function formatEndpointList(endpoints: EndpointSummary[]): string {
  if (endpoints.length === 0) return "(no endpoints)";
  const maxMethod = Math.max(...endpoints.map((e) => e.method.length));
  const maxPath = Math.max(...endpoints.map((e) => e.path.length));
  return endpoints
    .map((e) => {
      const method = e.method.padEnd(maxMethod);
      const path = e.path.padEnd(maxPath);
      const summary = e.summary ?? "";
      return `  ${method}  ${path}  ${summary}`.trimEnd();
    })
    .join("\n");
}

function formatEndpointDetail(ep: EndpointDetail): string {
  const lines: string[] = [];
  lines.push(`Endpoint:    ${ep.method} ${ep.path}`);
  if (ep.summary) lines.push(`Summary:     ${ep.summary}`);
  if (ep.description) lines.push(`Description: ${ep.description}`);

  if (ep.parameters.length > 0) {
    lines.push("", "Parameters:", JSON.stringify(ep.parameters, null, 2));
  }

  if (ep.requestBody) {
    lines.push(
      "",
      `Request body (${ep.requestBody.contentType}):`,
      JSON.stringify(ep.requestBody.schema, null, 2),
    );
  }

  const statuses = Object.keys(ep.responses);
  if (statuses.length > 0) {
    lines.push("", "Responses:");
    for (const status of statuses.sort()) {
      const r = ep.responses[status];
      const header = `  ${status}${r.contentType ? ` ${r.contentType}` : ""}${
        r.description ? ` — ${r.description}` : ""
      }`;
      lines.push(header);
      if (r.schema !== null && r.schema !== undefined) {
        lines.push(indent(JSON.stringify(r.schema, null, 2), "  "));
      }
    }
  }

  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}
