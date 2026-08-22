import { describe, it, expect, vi, afterEach } from "vitest";
import { ErrorCode, OperationError } from "../errors.js";
import { ApiRequestError, httpRequest } from "./http-client.js";
import type { ApiTarget } from "./runtime-config.js";

const LOCAL: ApiTarget = {
  apiUrl: "http://localhost:3000",
  apiUrlSource: "default",
  apiTokenSource: "none",
};

describe("httpRequest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // A Response body reads once, so each call needs a fresh one.
  function respondWith(body: BodyInit | null, status = 200): void {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(body, { status })),
      );
  }

  it("returns the parsed JSON payload of a success response", async () => {
    respondWith(JSON.stringify({ ok: true, data: [{ id: 1 }] }));

    await expect(httpRequest(LOCAL, "GET", "/api/ping")).resolves.toEqual({
      ok: true,
      data: [{ id: 1 }],
    });
  });

  it("returns an empty object for an empty 2xx response body", async () => {
    respondWith(null, 204);

    await expect(httpRequest(LOCAL, "DELETE", "/api/thing/1")).resolves.toEqual(
      {},
    );
  });

  it("sends a bearer token only when the target carries one", async () => {
    respondWith(JSON.stringify({ ok: true }));

    await httpRequest(LOCAL, "GET", "/api/ping");
    await httpRequest(
      { ...LOCAL, apiToken: "spat_123_secret", apiTokenSource: "env" },
      "GET",
      "/api/ping",
    );

    const headersOf = (call: number) =>
      (vi.mocked(globalThis.fetch).mock.calls[call][1] as RequestInit).headers;
    expect(headersOf(0)).not.toHaveProperty("Authorization");
    expect(headersOf(1)).toHaveProperty(
      "Authorization",
      "Bearer spat_123_secret",
    );
  });

  // A leading slash on the path would make URL resolution discard the prefix
  // and call a different deployment on the same host.
  it("keeps a path prefix in the deployment URL", async () => {
    respondWith(JSON.stringify({ ok: true }));

    await httpRequest(
      { ...LOCAL, apiUrl: "https://host/apps/acme" },
      "GET",
      "/api/ping",
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("https://host/apps/acme/api/ping"),
      expect.anything(),
    );
  });
});

describe("httpRequest failures", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function failureOf(
    target: ApiTarget = LOCAL,
  ): Promise<ApiRequestError> {
    try {
      await httpRequest(target, "GET", "/api/meta/tables");
    } catch (err) {
      if (err instanceof ApiRequestError) return err;
      throw err;
    }
    throw new Error("Expected httpRequest to fail.");
  }

  function respondWith(body: BodyInit | null, status: number): void {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status }));
  }

  it("reports an unreachable server against an unconfirmed target", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      }),
    );

    const err = await failureOf();

    expect(err).toBeInstanceOf(OperationError);
    expect(err.code).toBe(ErrorCode.APP_SERVER_UNREACHABLE);
    expect(err.requestUrl).toBe("http://localhost:3000/api/meta/tables");
    expect(err.targetConfirmed).toBe(false);
  });

  // The observed failure: a command aimed at another project's server gets a
  // reply that is correct for that server. Every deployment answers a foreign
  // token this way, so the reply does not establish which one was reached.
  it("leaves the target unconfirmed when the app does not recognise the caller", async () => {
    respondWith(
      JSON.stringify({
        error: "Authentication required",
        code: "unauthenticated",
      }),
      401,
    );

    const err = await failureOf();

    expect(err.code).toBe("unauthenticated");
    expect(err.message).toBe("Authentication required");
    expect(err.targetConfirmed).toBe(false);
  });

  // A code the app could only produce for itself proves the request arrived
  // where it was aimed. That includes token_expired, which requires the server
  // to have found the token in its own database.
  it.each(["TABLE_NOT_FOUND", "token_expired"])(
    "confirms the target when the app answers %s",
    async (code) => {
      respondWith(JSON.stringify({ error: "Nope", code }), 404);

      await expect(failureOf()).resolves.toMatchObject({
        code,
        targetConfirmed: true,
      });
    },
  );

  it("leaves the target unconfirmed when the body carries no code", async () => {
    respondWith(JSON.stringify({ error: "Bad gateway" }), 502);

    const err = await failureOf();

    expect(err.code).toBe("HTTP_502");
    expect(err.message).toBe("Bad gateway");
    expect(err.targetConfirmed).toBe(false);
  });

  // A dev server on a neighbouring port answers 200 with HTML. Treating that
  // as a payload printed markup as a successful result.
  it("fails on a non-JSON body instead of returning it as a payload", async () => {
    respondWith("<!doctype html><html></html>", 200);

    const err = await failureOf();

    expect(err.code).toBe(ErrorCode.NON_JSON_RESPONSE);
    expect(err.message).toContain("<!doctype html>");
    expect(err.targetConfirmed).toBe(false);
  });
});
