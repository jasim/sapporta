import { describe, it, expect, vi } from "vitest";
import {
  listEndpoints,
  findEndpoint,
  getEndpointDetail,
  resolveRefs,
  fetchOpenApiSpec,
  type OpenApiDoc,
} from "./openapi-spec.js";

vi.mock("./http-client.js", () => ({
  httpRequest: vi.fn(),
}));
import { httpRequest } from "./http-client.js";

function makeSpec(paths: Record<string, any>, components?: any): OpenApiDoc {
  return { openapi: "3.1.0", paths, components };
}

describe("resolveRefs", () => {
  const spec = makeSpec(
    {},
    {
      schemas: {
        X: { type: "string" },
        Y: { type: "object", properties: { x: { $ref: "#/components/schemas/X" } } },
        Cycle: {
          type: "object",
          properties: { self: { $ref: "#/components/schemas/Cycle" } },
        },
      },
    },
  );

  it("inlines a simple ref", () => {
    const out = resolveRefs({ a: { $ref: "#/components/schemas/X" } }, spec);
    expect(out).toEqual({ a: { type: "string" } });
  });

  it("inlines nested refs", () => {
    const out = resolveRefs({ $ref: "#/components/schemas/Y" }, spec);
    expect(out).toEqual({
      type: "object",
      properties: { x: { type: "string" } },
    });
  });

  it("inlines refs inside arrays", () => {
    const out = resolveRefs(
      [{ $ref: "#/components/schemas/X" }, { $ref: "#/components/schemas/X" }],
      spec,
    );
    expect(out).toEqual([{ type: "string" }, { type: "string" }]);
  });

  it("breaks cycles by leaving $ref in place", () => {
    const out = resolveRefs({ $ref: "#/components/schemas/Cycle" }, spec) as any;
    expect(out.type).toBe("object");
    expect(out.properties.self).toEqual({ $ref: "#/components/schemas/Cycle" });
  });

  it("leaves unknown refs untouched", () => {
    const out = resolveRefs(
      { $ref: "#/components/schemas/DoesNotExist" },
      spec,
    );
    expect(out).toEqual({ $ref: "#/components/schemas/DoesNotExist" });
  });

  it("leaves external refs untouched", () => {
    const out = resolveRefs({ $ref: "other.json#/X" }, spec);
    expect(out).toEqual({ $ref: "other.json#/X" });
  });

  it("does not mutate input", () => {
    const input = { a: { $ref: "#/components/schemas/X" } };
    const snapshot = JSON.parse(JSON.stringify(input));
    resolveRefs(input, spec);
    expect(input).toEqual(snapshot);
  });
});

describe("listEndpoints", () => {
  it("flattens and sorts by path then method", () => {
    const spec = makeSpec({
      "/b": { get: { summary: "get b" } },
      "/a": {
        get: { summary: "get a", tags: ["t"] },
        post: { summary: "post a" },
      },
    });
    const list = listEndpoints(spec);
    expect(list).toEqual([
      { method: "GET", path: "/a", summary: "get a", tags: ["t"] },
      { method: "POST", path: "/a", summary: "post a" },
      { method: "GET", path: "/b", summary: "get b" },
    ]);
  });

  it("omits summary and tags when absent", () => {
    const spec = makeSpec({ "/x": { get: {} } });
    expect(listEndpoints(spec)).toEqual([{ method: "GET", path: "/x" }]);
  });

  it("ignores non-operation path keys", () => {
    const spec = makeSpec({
      "/x": {
        summary: "path summary",
        parameters: [{ name: "q", in: "query" }],
        get: { summary: "op" },
      },
    });
    const list = listEndpoints(spec);
    expect(list).toHaveLength(1);
    expect(list[0].method).toBe("GET");
  });
});

describe("findEndpoint", () => {
  const spec = makeSpec(
    {
      "/invoices": {
        get: { summary: "List invoices" },
        post: {
          summary: "Create an invoice",
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Invoice" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/accounts": {
        post: { summary: "Create an account" },
      },
    },
    { schemas: { Invoice: { type: "object", properties: { amount: { type: "number" } } } } },
  );

  it("hits on exact METHOD path", () => {
    const r = findEndpoint(spec, "POST /invoices");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") return;
    expect(r.endpoint.method).toBe("POST");
    expect(r.endpoint.requestBody?.schema).toEqual({
      type: "object",
      properties: { amount: { type: "number" } },
    });
  });

  it("method is case-insensitive", () => {
    const r = findEndpoint(spec, "post /invoices");
    expect(r.kind).toBe("hit");
  });

  it("hits on path-only when exactly one method exists", () => {
    const r = findEndpoint(spec, "/accounts");
    expect(r.kind).toBe("hit");
  });

  it("is ambiguous on path-only with multiple methods", () => {
    const r = findEndpoint(spec, "/invoices");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates).toHaveLength(2);
  });

  it("misses on unknown path with suggestions", () => {
    const r = findEndpoint(spec, "/nope");
    expect(r.kind).toBe("miss");
  });

  it("accepts prefix-less METHOD path by falling back to /api/", () => {
    const s = makeSpec({
      "/api/accounts": {
        post: { summary: "Create account" },
      },
    });
    const r = findEndpoint(s, "POST /accounts");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") return;
    expect(r.endpoint.path).toBe("/api/accounts");
  });

  it("accepts prefix-less path-only by falling back to /api/", () => {
    const s = makeSpec({
      "/api/accounts": {
        post: { summary: "Create account" },
      },
    });
    const r = findEndpoint(s, "/accounts");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") return;
    expect(r.endpoint.path).toBe("/api/accounts");
  });

  it("prefix-less match resolves to ambiguous when multiple methods exist", () => {
    const s = makeSpec({
      "/api/invoices": {
        get: { summary: "list" },
        post: { summary: "create" },
      },
    });
    const r = findEndpoint(s, "/invoices");
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates.every((c) => c.path === "/api/invoices")).toBe(true);
  });

  it("prefers literal match over /api/ fallback", () => {
    const s = makeSpec({
      "/accounts": { get: { summary: "literal" } },
      "/api/accounts": { get: { summary: "prefixed" } },
    });
    const r = findEndpoint(s, "GET /accounts");
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") return;
    expect(r.endpoint.path).toBe("/accounts");
    expect(r.endpoint.summary).toBe("literal");
  });

  it("freeform query never hits even with one summary match", () => {
    const r = findEndpoint(spec, "Create an invoice");
    expect(r.kind).toBe("miss");
    if (r.kind !== "miss") return;
    expect(r.suggestions[0].summary).toBe("Create an invoice");
  });

  it("dedupes suggestions that match via path and summary", () => {
    const s = makeSpec({
      "/invoices": { get: { summary: "invoices list" } },
    });
    const r = findEndpoint(s, "invoices");
    if (r.kind !== "miss") throw new Error("expected miss");
    expect(r.suggestions).toHaveLength(1);
  });

  it("caps suggestions at 8", () => {
    const paths: Record<string, any> = {};
    for (let i = 0; i < 20; i++) {
      paths[`/foo${i}`] = { get: { summary: `foo ${i}` } };
    }
    const r = findEndpoint(makeSpec(paths), "foo");
    if (r.kind !== "miss") throw new Error("expected miss");
    expect(r.suggestions).toHaveLength(8);
  });
});

describe("getEndpointDetail", () => {
  const spec = makeSpec(
    {
      "/things/{id}": {
        post: {
          summary: "Create thing",
          description: "Creates one thing",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "q", in: "query", schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Thing" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "422": {
              description: "Invalid",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
        get: { summary: "Get thing" },
      },
    },
    { schemas: { Thing: { type: "object" } } },
  );

  it("returns inlined parameters, body, and both responses", () => {
    const d = getEndpointDetail(spec, "POST", "/things/{id}");
    expect(d.parameters).toHaveLength(2);
    expect(d.requestBody?.schema).toEqual({ type: "object" });
    expect(Object.keys(d.responses)).toEqual(["201", "422"]);
    expect(d.description).toBe("Creates one thing");
  });

  it("returns null requestBody when absent", () => {
    const d = getEndpointDetail(spec, "GET", "/things/{id}");
    expect(d.requestBody).toBeNull();
  });

  it("returns empty parameters array when absent", () => {
    const d = getEndpointDetail(spec, "GET", "/things/{id}");
    expect(d.parameters).toEqual([]);
  });

  it("throws when operation is missing", () => {
    expect(() => getEndpointDetail(spec, "DELETE", "/things/{id}")).toThrow();
  });
});

describe("fetchOpenApiSpec", () => {
  it("returns the parsed JSON on success", async () => {
    const doc = { openapi: "3.1.0", paths: {} };
    (httpRequest as any).mockResolvedValueOnce({ status: 200, data: doc });
    const out = await fetchOpenApiSpec("http://localhost:3000");
    expect(out).toEqual(doc);
  });

  it("propagates the ECONNREFUSED friendly error", async () => {
    (httpRequest as any).mockRejectedValueOnce(
      new Error("Cannot connect to Sapporta server at http://localhost:3000. Is the server running?"),
    );
    await expect(fetchOpenApiSpec("http://localhost:3000")).rejects.toThrow(
      /Is the server running\?/,
    );
  });
});
