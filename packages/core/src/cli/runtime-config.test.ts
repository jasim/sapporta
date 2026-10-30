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

  it("falls back to the surrounding project's API URL when no flag or env is set", () => {
    expect(
      resolveCliRuntimeConfig(
        {},
        {},
        { isTTY: false },
        { apiUrl: "http://localhost:3117" },
      ),
    ).toEqual({
      apiUrl: "http://localhost:3117",
      apiUrlSource: "project",
      apiTokenSource: "none",
      output: "json",
    });
  });

  it("prefers an explicit flag or env over the surrounding project", () => {
    expect(
      resolveCliRuntimeConfig(
        {},
        { SAPPORTA_API_URL: "https://env.example.com" },
        { isTTY: false },
        { apiUrl: "http://localhost:3117" },
      ).apiUrl,
    ).toBe("https://env.example.com");

    expect(
      resolveCliRuntimeConfig(
        { apiUrl: "https://flag.example.com" },
        { SAPPORTA_API_URL: "https://env.example.com" },
        { isTTY: false },
        { apiUrl: "http://localhost:3117" },
      ).apiUrl,
    ).toBe("https://flag.example.com");
  });

  it("sends the surrounding project's token after an explicit flag or env", () => {
    const apiToken = "spat_0505050001_project";
    expect(
      resolveCliRuntimeConfig({}, {}, { isTTY: false }, { apiToken }),
    ).toMatchObject({ apiToken, apiTokenSource: "project" });
    expect(
      resolveCliRuntimeConfig(
        {},
        {},
        { isTTY: false },
        { apiUrl: "http://localhost:3117", apiToken },
      ),
    ).toMatchObject({ apiToken, apiTokenSource: "project" });
    expect(
      resolveCliRuntimeConfig(
        {},
        { SAPPORTA_API_TOKEN: "spat_0505050002_env" },
        { isTTY: false },
        { apiToken },
      ),
    ).toMatchObject({ apiToken: "spat_0505050002_env", apiTokenSource: "env" });
    expect(
      resolveCliRuntimeConfig(
        { apiToken: "spat_0505050003_flag" },
        {},
        { isTTY: false },
        { apiToken },
      ),
    ).toMatchObject({
      apiToken: "spat_0505050003_flag",
      apiTokenSource: "flag",
    });
    expect(
      resolveCliRuntimeConfig({}, { SAPPORTA_API_TOKEN: "" }, { isTTY: false }),
    ).toMatchObject({ apiTokenSource: "none" });
  });

  it("withholds the project's token from an API URL chosen by flag or env", () => {
    const apiToken = "spat_0505050001_project";
    const fromFlag = resolveCliRuntimeConfig(
      { apiUrl: "https://flag.example.com" },
      {},
      { isTTY: false },
      { apiToken },
    );
    expect(fromFlag.apiTokenSource).toBe("withheld");
    expect(fromFlag.apiToken).toBeUndefined();

    const fromEnv = resolveCliRuntimeConfig(
      {},
      { SAPPORTA_API_URL: "https://env.example.com" },
      { isTTY: false },
      { apiToken },
    );
    expect(fromEnv.apiTokenSource).toBe("withheld");
    expect(fromEnv.apiToken).toBeUndefined();

    expect(
      resolveCliRuntimeConfig(
        { apiUrl: "https://flag.example.com" },
        { SAPPORTA_API_TOKEN: "spat_0505050002_env" },
        { isTTY: false },
        { apiToken },
      ),
    ).toMatchObject({ apiToken: "spat_0505050002_env", apiTokenSource: "env" });
  });

  it("rejects unknown output formats", () => {
    expect(() =>
      resolveCliRuntimeConfig({ output: "yaml" }, {}, { isTTY: false }),
    ).toThrow(OperationError);
  });
});
