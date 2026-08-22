import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCommandError, renderCommandResult } from "./output.js";
import { ApiRequestError } from "../http-client.js";
import type { ApiTarget, OutputFormat } from "../runtime-config.js";

describe("renderCommandResult", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints raw JSON output when available", () => {
    renderCommandResult(
      { data: [{ id: 1 }], raw: { data: [{ id: 1 }], meta: { total: 1 } } },
      "json",
    );

    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      data: [{ id: 1 }],
      meta: { total: 1 },
    });
  });

  it("renders table output with an optional message", () => {
    renderCommandResult(
      { message: "Rows:", data: [{ id: 1, name: "Cash" }] },
      "table",
    );

    expect(logSpy.mock.calls[0][0]).toBe("Rows:");
    expect(logSpy.mock.calls[1][0]).toContain("Cash");
  });

  it("honors tableOutputHandled for custom text renderers", () => {
    renderCommandResult(
      {
        message: "Endpoint: GET /api/books",
        data: [],
        tableOutputHandled: true,
      },
      "table" satisfies OutputFormat,
    );

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith("Endpoint: GET /api/books");
  });
});

describe("renderCommandError", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const LOCAL: ApiTarget = {
    apiUrl: "http://localhost:3000",
    apiUrlSource: "default",
    apiTokenSource: "none",
  };

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function render(err: unknown, format: OutputFormat): void {
    expect(() => renderCommandError(err, format)).toThrow("exit");
  }

  function apiError(code: string, targetConfirmed: boolean): ApiRequestError {
    return new ApiRequestError({
      message: "Authentication required",
      code,
      target: LOCAL,
      requestUrl: "http://localhost:3000/api/meta/tables",
      targetConfirmed,
    });
  }

  it("names the deployment and both settings when the target is unconfirmed", () => {
    render(apiError("unauthenticated", false), "table");

    expect(
      errorSpy.mock.calls.map((call: unknown[]) => String(call[0])),
    ).toEqual([
      "Error: Authentication required",
      "  Requested http://localhost:3000/api/meta/tables",
      "  API URL from the built-in default — set SAPPORTA_API_URL or pass --api-url",
      "  No API token sent — set SAPPORTA_API_TOKEN or pass --api-token",
    ]);
  });

  // The narrowing that keeps the target off every unrelated failure: a domain
  // error proves the app handled the request, so the target is settled.
  it("stays quiet about the target when the app answered for itself", () => {
    render(apiError("TABLE_NOT_FOUND", true), "table");

    expect(
      errorSpy.mock.calls.map((call: unknown[]) => String(call[0])),
    ).toEqual(["Error: Authentication required"]);
  });

  it("carries the target as structured JSON rather than prose", () => {
    render(apiError("unauthenticated", false), "json");

    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      ok: false,
      error: "Authentication required",
      code: "unauthenticated",
      target: {
        requestUrl: "http://localhost:3000/api/meta/tables",
        apiUrl: "http://localhost:3000",
        apiUrlSource: "default",
        apiTokenSource: "none",
      },
    });
  });
});
