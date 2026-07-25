import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCS_ORIGIN,
  DEFAULT_SKILL_SOURCE,
  resolveGettingStartedEnv,
} from "./getting-started-env.js";

describe("resolveGettingStartedEnv", () => {
  it("uses published values when environment variables are absent", () => {
    expect(resolveGettingStartedEnv({})).toEqual({
      docsOrigin: DEFAULT_DOCS_ORIGIN,
      docsBrowserUrl: "https://sapporta.com/docs/getting-started/introduction/",
      docsAgentUrl: "https://sapporta.com/docs/getting-started/introduction.md",
      skillSource: DEFAULT_SKILL_SOURCE,
    });
  });

  it("uses independently configured environment values", () => {
    expect(
      resolveGettingStartedEnv({
        SAPPORTA_DOCS_ORIGIN: "http://127.0.0.1:4321",
        SAPPORTA_SKILL_SOURCE: "/tmp/sapporta skills",
      }),
    ).toEqual({
      docsOrigin: "http://127.0.0.1:4321",
      docsBrowserUrl:
        "http://127.0.0.1:4321/docs/getting-started/introduction/",
      docsAgentUrl:
        "http://127.0.0.1:4321/docs/getting-started/introduction.md",
      skillSource: "/tmp/sapporta skills",
    });
  });

  it("allows one value to be overridden without selecting a mode", () => {
    expect(
      resolveGettingStartedEnv({
        SAPPORTA_DOCS_ORIGIN: "https://preview.example.com",
      }),
    ).toEqual({
      docsOrigin: "https://preview.example.com",
      docsBrowserUrl:
        "https://preview.example.com/docs/getting-started/introduction/",
      docsAgentUrl:
        "https://preview.example.com/docs/getting-started/introduction.md",
      skillSource: DEFAULT_SKILL_SOURCE,
    });
  });

  it("rejects malformed environment values", () => {
    expect(() =>
      resolveGettingStartedEnv({
        SAPPORTA_DOCS_ORIGIN: "http://127.0.0.1:4321/docs",
      }),
    ).toThrow(/absolute HTTP\(S\) origin/);

    expect(() =>
      resolveGettingStartedEnv({
        SAPPORTA_SKILL_SOURCE: "./skills",
      }),
    ).toThrow(/absolute filesystem path or HTTP\(S\) URL/);
  });
});
