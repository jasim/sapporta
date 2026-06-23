import { describe, it, expect, vi, afterEach } from "vitest";
import { ErrorCode, OperationError } from "../introspect/types.js";
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

    const result = await httpRequest(
      "http://localhost:3000",
      "GET",
      "/api/ping",
    );
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

    const result = await httpRequest(
      "http://localhost:3000",
      "GET",
      "/api/boom",
    );
    expect(result.status).toBe(500);
    expect(result.data).toEqual({
      ok: false,
      error: "Internal Server Error",
      code: "NON_JSON_RESPONSE",
    });
  });

  it("returns {} for an empty 2xx response body", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const result = await httpRequest(
      "http://localhost:3000",
      "DELETE",
      "/api/thing/1",
    );
    expect(result.status).toBe(204);
    expect(result.data).toEqual({});
  });

  it("sends a bearer token when authToken is provided", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    await httpRequest("http://localhost:3000", "GET", "/api/ping", {
      authToken: "spat_123_secret",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("http://localhost:3000/api/ping"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer spat_123_secret",
        }),
      }),
    );
  });

  it("omits authorization when no token is provided", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    await httpRequest("http://localhost:3000", "GET", "/api/ping");

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(init).toMatchObject({
      headers: {
        "Content-Type": "application/json",
      },
    });
  });

  it("truncates a large non-JSON body to 500 chars with an ellipsis", async () => {
    const big = "x".repeat(1000);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(big, { status: 500 }));

    const result = await httpRequest(
      "http://localhost:3000",
      "GET",
      "/api/boom",
    );
    const data = result.data as { error: string; code: string };
    expect(data.code).toBe("NON_JSON_RESPONSE");
    expect(data.error).toBe("x".repeat(500) + "…");
  });

  it("throws a structured unreachable-server error when fetch cannot reach the app", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      }),
    );

    try {
      await httpRequest("http://localhost:3000", "GET", "/api/openapi.json");
      throw new Error("Expected httpRequest to fail.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({
        code: ErrorCode.APP_SERVER_UNREACHABLE,
        message:
          "Unable to reach the Sapporta app server at http://localhost:3000/api/openapi.json. Check that the server is running and that this process has permission to make network requests. In sandboxed coding-agent environments, rerun with network permissions enabled.",
      });
    }
  });

  it("includes query params in the unreachable-server URL", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      httpRequest("http://localhost:3000", "GET", "/api/tables/books", {
        queryParams: { search: "Austen" },
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.APP_SERVER_UNREACHABLE,
      message:
        "Unable to reach the Sapporta app server at http://localhost:3000/api/tables/books?search=Austen. Check that the server is running and that this process has permission to make network requests. In sandboxed coding-agent environments, rerun with network permissions enabled.",
    });
  });
});
