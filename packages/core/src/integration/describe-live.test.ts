/**
 * End-to-end test for `sapporta describe` against a real booted project.
 *
 * Stubs global.fetch to route through the in-memory OpenAPIHono app, so the
 * full path runs: describe → fetchOpenApiSpec → httpRequest → app.request →
 * served /openapi.json → rendering. This is the only guard that catches
 * regressions in the stack between IMPL-3 (built-in port), IMPL-4
 * (dynamic specialization) and IMPL-6 (describe rendering).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIntegrationApp } from "./setup.js";
import { describeAll, describeOne } from "../cli/describe.js";

const BASE_URL = "http://localhost:3000";
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const { app } = await createIntegrationApp();
  globalThis.fetch = (async (input: any, init?: any) => {
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

describe("describe — live server", () => {
  it("describeAll surfaces built-in and app endpoints", async () => {
    const result = await describeAll(BASE_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.data.map((d: any) => `${d.method} ${d.path}`);
    expect(keys.some((k) => k.includes("/api/meta/"))).toBe(true);
    expect(keys).toContain("POST /api/accounts");
  });

  it("describeOne('POST /api/accounts') returns request body + success response schema", async () => {
    const result = await describeOne("POST /api/accounts", BASE_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ep = result.data[0] as any;
    expect(ep.requestBody).not.toBeNull();
    expect(ep.requestBody.schema).toBeTruthy();
    // Handler returns 200; describe rendering may surface either 200 or 201.
    const success = ep.responses["200"] ?? ep.responses["201"];
    expect(success).toBeDefined();
    expect(success.schema).toBeTruthy();
  });

  it("describeOne('GET /api/meta/tables') returns a non-trivial response schema", async () => {
    const result = await describeOne("GET /api/meta/tables", BASE_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ep = result.data[0] as any;
    const schema = ep.responses["200"]?.schema;
    expect(schema).toBeTruthy();
    expect(schema.properties ?? schema.items ?? schema.type).toBeTruthy();
  });

  it("describeOne('POST /api/tables/accounts') returns the specialized accounts shape", async () => {
    const result = await describeOne("POST /api/tables/accounts", BASE_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ep = result.data[0] as any;
    const bodySchema = ep.requestBody?.schema;
    expect(bodySchema).toBeTruthy();
    // Specialized: should mention an accounts-specific column, not just
    // an unconstrained record.
    const serialized = JSON.stringify(bodySchema);
    expect(serialized).toContain("name");
  });
});
