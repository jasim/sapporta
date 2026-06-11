import { describe, expect, it } from "vitest";
import { resolveCliCredentials } from "./credentials.js";

describe("resolveCliCredentials", () => {
  it("uses default localhost URL without a token", () => {
    expect(resolveCliCredentials({}, {})).toEqual({
      apiUrl: "http://localhost:3000",
    });
  });

  it("reads API URL and token from env", () => {
    expect(
      resolveCliCredentials(
        {},
        {
          SAPPORTA_API_URL: "https://app.example.com/",
          SAPPORTA_API_TOKEN: "env-token",
        },
      ),
    ).toEqual({
      apiUrl: "https://app.example.com",
      apiToken: "env-token",
    });
  });

  it("lets flags override env credentials", () => {
    expect(
      resolveCliCredentials(
        {
          "api-url": "https://flag.example.com/",
          "api-token": "flag-token",
        },
        {
          SAPPORTA_API_URL: "https://env.example.com",
          SAPPORTA_API_TOKEN: "env-token",
        },
      ),
    ).toEqual({
      apiUrl: "https://flag.example.com",
      apiToken: "flag-token",
    });
  });
});
