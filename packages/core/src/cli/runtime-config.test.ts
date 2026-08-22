import { describe, expect, it } from "vitest";
import { OperationError } from "../errors.js";
import { resolveCliRuntimeConfig } from "./runtime-config.js";

describe("resolveCliRuntimeConfig", () => {
  it("uses localhost, json output, and no token by default", () => {
    expect(resolveCliRuntimeConfig({}, {}, { isTTY: false })).toEqual({
      apiUrl: "http://localhost:3000",
      apiUrlSource: "default",
      apiTokenSource: "none",
      output: "json",
    });
  });

  it("defaults to table output for interactive terminals", () => {
    expect(resolveCliRuntimeConfig({}, {}, { isTTY: true })).toEqual({
      apiUrl: "http://localhost:3000",
      apiUrlSource: "default",
      apiTokenSource: "none",
      output: "table",
    });
  });

  it("reads API, token, and output settings from env", () => {
    expect(
      resolveCliRuntimeConfig(
        {},
        {
          SAPPORTA_API_URL: "https://app.example.com/",
          SAPPORTA_API_TOKEN: "env-token",
          SAPPORTA_OUTPUT_FORMAT: "table",
        },
        { isTTY: false },
      ),
    ).toEqual({
      apiUrl: "https://app.example.com",
      apiUrlSource: "env",
      apiToken: "env-token",
      apiTokenSource: "env",
      output: "table",
    });
  });

  it("lets flags override env settings", () => {
    expect(
      resolveCliRuntimeConfig(
        {
          apiUrl: "https://flag.example.com/",
          apiToken: "flag-token",
          output: "json",
        },
        {
          SAPPORTA_API_URL: "https://env.example.com",
          SAPPORTA_API_TOKEN: "env-token",
          SAPPORTA_OUTPUT_FORMAT: "table",
        },
        { isTTY: true },
      ),
    ).toEqual({
      apiUrl: "https://flag.example.com",
      apiUrlSource: "flag",
      apiToken: "flag-token",
      apiTokenSource: "flag",
      output: "json",
    });
  });

  it("rejects unknown output formats", () => {
    expect(() =>
      resolveCliRuntimeConfig({ output: "yaml" }, {}, { isTTY: false }),
    ).toThrow(OperationError);
  });
});
