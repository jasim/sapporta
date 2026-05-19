import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveOutputFormat, emitResult } from "./format.js";

// ---------------------------------------------------------------------------
// resolveOutputFormat tests
// ---------------------------------------------------------------------------
// Resolution priority: --output-format flag > SAPPORTA_OUTPUT_FORMAT env > TTY detection.
// This order matters because agents running in pipelines need predictable
// format selection without needing to pass --output-format on every call.

describe("resolveOutputFormat", () => {
  const originalEnv = process.env.SAPPORTA_OUTPUT_FORMAT;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    // Restore environment to prevent test pollution
    if (originalEnv === undefined) {
      delete process.env.SAPPORTA_OUTPUT_FORMAT;
    } else {
      process.env.SAPPORTA_OUTPUT_FORMAT = originalEnv;
    }
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true });
  });

  it("returns json when --output-format json is passed", () => {
    expect(resolveOutputFormat({ "output-format": "json" })).toBe("json");
  });

  it("returns table when --output-format table is passed", () => {
    expect(resolveOutputFormat({ "output-format": "table" })).toBe("table");
  });

  it("uses SAPPORTA_OUTPUT_FORMAT env when no flag", () => {
    process.env.SAPPORTA_OUTPUT_FORMAT = "json";
    expect(resolveOutputFormat({})).toBe("json");
  });

  it("--output-format flag takes precedence over env var", () => {
    process.env.SAPPORTA_OUTPUT_FORMAT = "json";
    expect(resolveOutputFormat({ "output-format": "table" })).toBe("table");
  });

  it("defaults to json when stdout is not a TTY (agent/pipe mode)", () => {
    delete process.env.SAPPORTA_OUTPUT_FORMAT;
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, writable: true });
    expect(resolveOutputFormat({})).toBe("json");
  });

  it("defaults to table when stdout is a TTY (interactive mode)", () => {
    delete process.env.SAPPORTA_OUTPUT_FORMAT;
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(resolveOutputFormat({})).toBe("table");
  });
});

// ---------------------------------------------------------------------------
// emitResult tests
// ---------------------------------------------------------------------------
// emitResult is the SOLE output point — commands never call console.log
// directly. These tests verify both JSON and table mode rendering.

describe("emitResult", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // -- JSON mode --

  it("JSON mode: emits success result as single JSON line", () => {
    emitResult({ ok: true, data: [{ id: 1 }] }, "json");
    expect(logSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual([{ id: 1 }]);
  });

  it("JSON mode: emits error result as single JSON line", () => {
    emitResult({ ok: false, error: "not found", code: "TABLE_NOT_FOUND" }, "json");
    expect(logSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("not found");
    expect(parsed.code).toBe("TABLE_NOT_FOUND");
  });

  // -- Table mode --

  it("table mode: prints error to stderr", () => {
    emitResult({ ok: false, error: "bad input", code: "INVALID_JSON" }, "table");
    expect(errorSpy).toHaveBeenCalledWith("Error: bad input");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("table mode: prints message from meta", () => {
    emitResult({ ok: true, data: [], meta: { message: "Done!" } }, "table");
    expect(logSpy).toHaveBeenCalledWith("Done!");
  });

  it("table mode: renders data rows as a formatted table", () => {
    emitResult(
      { ok: true, data: [{ id: 1, name: "Cash" }] },
      "table",
    );
    // formatTable produces header + separator + data rows
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("id");
    expect(output).toContain("name");
    expect(output).toContain("Cash");
  });

  it("table mode: skips formatTable when tableOutputHandled is true", () => {
    // Commands like report-execute set tableOutputHandled to indicate they've
    // already formatted the output into the message/additionalOutput fields.
    emitResult(
      {
        ok: true,
        data: [{ id: 1 }],
        meta: { message: "Custom output", tableOutputHandled: true },
      },
      "table",
    );
    // Only the message should be logged, not the data table
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Custom output");
  });

  it("table mode: emits additionalOutput after the main table", () => {
    emitResult(
      {
        ok: true,
        data: [],
        meta: { message: "Header", additionalOutput: "Extra section" },
      },
      "table",
    );
    expect(logSpy).toHaveBeenCalledWith("Header");
    expect(logSpy).toHaveBeenCalledWith("Extra section");
  });

  it("table mode: emits errorText to stderr", () => {
    emitResult(
      {
        ok: true,
        data: [],
        meta: { errorText: "Warning: something odd" },
      },
      "table",
    );
    expect(errorSpy).toHaveBeenCalledWith("Warning: something odd");
  });
});
