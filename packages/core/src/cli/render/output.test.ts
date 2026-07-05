import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCommandResult } from "./output.js";
import type { OutputFormat } from "../runtime-config.js";

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
