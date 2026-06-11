import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeAll, describeOne } from "./describe.js";
import type { OpenApiDoc } from "./openapi-spec.js";

vi.mock("./openapi-spec.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./openapi-spec.js")>();
  return { ...mod, fetchOpenApiSpec: vi.fn() };
});
import { fetchOpenApiSpec } from "./openapi-spec.js";

const STUB_SPEC: OpenApiDoc = {
  openapi: "3.1.0",
  paths: {
    "/api/meta/tables": {
      get: {
        summary: "List all tables",
        responses: {
          "200": {
            description: "Table list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tables: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/accounts": {
      post: {
        summary: "Create an account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created account",
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          "422": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
        },
      },
    },
    "/ambiguous-path": {
      get: { summary: "Get ambiguous", responses: { "200": { description: "ok" } } },
      post: { summary: "Post ambiguous", responses: { "200": { description: "ok" } } },
    },
  },
};

beforeEach(() => {
  vi.mocked(fetchOpenApiSpec).mockResolvedValue(STUB_SPEC);
});

describe("describeAll", () => {
  it("returns every operation sorted by path then method", async () => {
    const result = await describeAll("http://localhost:3000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
    const keys = result.data.map((d: any) => `${d.method} ${d.path}`);
    expect(keys).toEqual([
      "GET /ambiguous-path",
      "POST /ambiguous-path",
      "POST /api/accounts",
      "GET /api/meta/tables",
    ]);
  });

  it("passes bearer token through OpenAPI fetching", async () => {
    await describeAll("http://localhost:3000", "token-1");

    expect(fetchOpenApiSpec).toHaveBeenCalledWith(
      "http://localhost:3000",
      "token-1",
    );
  });

  it("renders a message containing paths and summaries", async () => {
    const result = await describeAll("http://localhost:3000");
    if (!result.ok) return;
    const msg = result.meta?.message ?? "";
    expect(msg).toContain("/api/meta/tables");
    expect(msg).toContain("List all tables");
    expect(msg).toContain("/api/accounts");
    expect(msg).toContain("Create an account");
  });
});

describe("describeOne", () => {
  it("hit: POST /api/accounts returns full detail including request body and responses", async () => {
    const result = await describeOne("POST /api/accounts", "http://localhost:3000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = result.data[0] as any;
    expect(detail.requestBody).not.toBeNull();
    expect(detail.requestBody.schema.properties.name).toBeDefined();
    expect(detail.responses["201"]).toBeDefined();
    expect(detail.responses["422"]).toBeDefined();
    const msg = result.meta?.message ?? "";
    expect(msg).toContain("201");
    expect(msg).toContain("422");
    expect(msg).toContain("Request body");
  });

  it("hit: GET /api/meta/tables renders without a Request body section", async () => {
    const result = await describeOne("GET /api/meta/tables", "http://localhost:3000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const msg = result.meta?.message ?? "";
    expect(msg).not.toContain("Request body");
    expect(msg).toContain("200");
  });

  it("ambiguous: path-only target with multiple methods", async () => {
    const result = await describeOne("/ambiguous-path", "http://localhost:3000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_ARGUMENT");
    expect(result.error).toContain("GET /ambiguous-path");
    expect(result.error).toContain("POST /ambiguous-path");
  });

  it("miss: unknown target returns error with did-you-mean section", async () => {
    const result = await describeOne("does-not-exist", "http://localhost:3000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_ARGUMENT");
    expect(result.error).toContain("No endpoint matches");
  });
});
