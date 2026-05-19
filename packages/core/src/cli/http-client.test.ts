import { describe, it, expect, vi, afterEach } from "vitest";
import { httpRequest } from "./http-client.js";

describe("httpRequest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("parses a JSON success body and returns it unchanged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: [{ id: 1 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await httpRequest("http://localhost:3000", "GET", "/api/ping");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, data: [{ id: 1 }] });
  });

  it("wraps a non-JSON 500 body in a NON_JSON_RESPONSE envelope without throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const result = await httpRequest("http://localhost:3000", "GET", "/api/boom");
    expect(result.status).toBe(500);
    expect(result.data).toEqual({
      ok: false,
      error: "Internal Server Error",
      code: "NON_JSON_RESPONSE",
    });
  });

  it("returns {} for an empty 2xx response body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = await httpRequest("http://localhost:3000", "DELETE", "/api/thing/1");
    expect(result.status).toBe(204);
    expect(result.data).toEqual({});
  });

  it("truncates a large non-JSON body to 500 chars with an ellipsis", async () => {
    const big = "x".repeat(1000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(big, { status: 500 }),
    );

    const result = await httpRequest("http://localhost:3000", "GET", "/api/boom");
    const data = result.data as { error: string; code: string };
    expect(data.code).toBe("NON_JSON_RESPONSE");
    expect(data.error).toBe("x".repeat(500) + "…");
  });
});
