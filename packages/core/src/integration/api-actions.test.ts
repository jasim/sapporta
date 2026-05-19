/**
 * Integration tests for user-defined OpenAPI routes (single-project mode).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createIntegrationApp, request, postJson } from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();
});

describe("user-defined app routes", () => {
  it("POST /accounts with valid input succeeds", async () => {
    const res = await postJson("/api/accounts", {
      name: "Action Cash",
      type: "asset",
      balance: 5000,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.name).toBe("Action Cash");
    expect(body.data.type).toBe("asset");
    expect(body.data.balance).toBe(5000);
    expect(body.data.id).toBeGreaterThan(0);
  });

  it("POST /accounts with invalid input returns 400", async () => {
    const res = await postJson("/api/accounts", {
      type: "invalid_type",
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/openapi.json returns valid OpenAPI 3.1 spec", async () => {
    const res = await request("/api/openapi.json");
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths).toBeDefined();
    expect(spec.paths["/api/accounts"]).toBeDefined();
    expect(spec.paths["/api/accounts"].post).toBeDefined();
  });
});
