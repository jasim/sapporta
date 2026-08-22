import { OperationError } from "../../errors.js";
import {
  findEndpoint,
  listEndpoints,
  type EndpointDetail,
  type EndpointSummary,
} from "../openapi-spec.js";
import type { SapportaCliClient } from "../client/app-client.js";
import type { CliCommandResult } from "../commands/types.js";

export async function endpointListResult(
  client: SapportaCliClient,
): Promise<CliCommandResult> {
  const endpoints = listEndpoints(await client.openApiSpec());
  return {
    data: endpoints.map(endpointSummaryRow),
    raw: endpoints,
  };
}

export async function endpointShowResult(
  client: SapportaCliClient,
  target: string,
): Promise<CliCommandResult> {
  const result = findEndpoint(await client.openApiSpec(), target);

  if (result.kind === "hit") {
    return {
      data: [endpointDetailRow(result.endpoint)],
      message: formatEndpointDetail(result.endpoint),
      tableOutputHandled: true,
      raw: result.endpoint,
    };
  }

  if (result.kind === "ambiguous") {
    const lines = result.candidates.map(
      (candidate) => `  ${candidate.method} ${candidate.path}`,
    );
    throw new OperationError(
      `Ambiguous endpoint "${target}". Candidates:\n${lines.join("\n")}`,
      "MISSING_ARGUMENT",
    );
  }

  const suggestions = result.suggestions.map(
    (suggestion) => `  ${suggestion.method} ${suggestion.path}`,
  );
  throw new OperationError(
    [
      `No endpoint matches "${target}".`,
      suggestions.length > 0 ? `Did you mean:\n${suggestions.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    "MISSING_ARGUMENT",
  );
}

function endpointSummaryRow(
  endpoint: EndpointSummary,
): Record<string, unknown> {
  return {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? "",
  };
}

function endpointDetailRow(endpoint: EndpointDetail): Record<string, unknown> {
  return {
    method: endpoint.method,
    path: endpoint.path,
    summary: endpoint.summary ?? "",
  };
}

function formatEndpointDetail(endpoint: EndpointDetail): string {
  const lines: string[] = [];
  lines.push(`Endpoint:    ${endpoint.method} ${endpoint.path}`);
  if (endpoint.summary) lines.push(`Summary:     ${endpoint.summary}`);
  if (endpoint.description) lines.push(`Description: ${endpoint.description}`);

  if (endpoint.parameters.length > 0) {
    lines.push("", "Parameters:", JSON.stringify(endpoint.parameters, null, 2));
  }

  if (endpoint.requestBody) {
    lines.push(
      "",
      `Request body (${endpoint.requestBody.contentType}):`,
      JSON.stringify(endpoint.requestBody.schema, null, 2),
    );
  }

  const statuses = Object.keys(endpoint.responses);
  if (statuses.length > 0) {
    lines.push("", "Responses:");
    for (const status of statuses.sort()) {
      const response = endpoint.responses[status];
      const header = `  ${status}${response.contentType ? ` ${response.contentType}` : ""}${
        response.description ? ` - ${response.description}` : ""
      }`;
      lines.push(header);
      if (response.schema !== null && response.schema !== undefined) {
        lines.push(indent(JSON.stringify(response.schema, null, 2), "  "));
      }
    }
  }

  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
