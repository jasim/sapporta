/**
 * End-to-end test for `sapporta endpoints` against a real booted project.
 *
 * Stubs global.fetch to route through the in-memory OpenAPIHono app, so the
 * full path runs: endpoints → fetchOpenApiSpec → httpRequest → app.request →
 * served /openapi.json → rendering. This is the only guard that catches
 * regressions in the stack between IMPL-3 (built-in port), IMPL-4
 * (dynamic specialization) and endpoint rendering.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIntegrationApp } from "./setup.js";
import {
  endpointListResult,
  endpointShowResult,
} from "../cli/openapi/endpoints.js";
import type { EndpointDetail } from "../cli/openapi-spec.js";

const BASE_URL = "http://localhost:3000";
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const { app } = await createIntegrationApp();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const u = new URL(urlStr);
    return app.request(u.pathname + u.search, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("endpoints — live server", () => {
  it("endpoints list surfaces built-in and app endpoints", async () => {
    const result = await endpointListResult(BASE_URL, undefined);
    const keys = result.data.map((row) => `${row.method} ${row.path}`);
    expect(keys.some((k) => k.includes("/api/meta/"))).toBe(true);
    expect(keys).toContain("POST /api/accounts");
  });

  it("endpoints show returns request body + success response schema", async () => {
    const result = await endpointShowResult(
      BASE_URL,
      undefined,
      "POST /api/accounts",
    );
    const endpoint = result.raw as EndpointDetail;
    expect(endpoint.requestBody).not.toBeNull();
    expect(endpoint.requestBody?.schema).toBeTruthy();
    // Handler returns 200; describe rendering may surface either 200 or 201.
    const success = endpoint.responses["200"] ?? endpoint.responses["201"];
    expect(success).toBeDefined();
    expect(success.schema).toBeTruthy();
  });

  it("endpoints show returns a non-trivial response schema", async () => {
    const result = await endpointShowResult(
      BASE_URL,
      undefined,
      "GET /api/meta/tables",
    );
    const endpoint = result.raw as EndpointDetail;
    const schema = endpoint.responses["200"]?.schema;
    expect(schema).toBeTruthy();
    expect(
      readRecord(schema).properties ??
        readRecord(schema).items ??
        readRecord(schema).type,
    ).toBeTruthy();
  });

  it("endpoints show returns the specialized accounts shape", async () => {
    const result = await endpointShowResult(
      BASE_URL,
      undefined,
      "POST /api/tables/accounts",
    );
    const endpoint = result.raw as EndpointDetail;
    const bodySchema = endpoint.requestBody?.schema;
    expect(bodySchema).toBeTruthy();
    // Specialized: should mention an accounts-specific column, not just
    // an unconstrained record.
    const serialized = JSON.stringify(bodySchema);
    expect(serialized).toContain("name");
  });
});

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
