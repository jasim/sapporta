/**
 * Integration tests for global (non-project-scoped) endpoints.
 *
 * These validate that the entire boot sequence completes successfully
 * and the health endpoint responds correctly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createIntegrationApp, request } from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
