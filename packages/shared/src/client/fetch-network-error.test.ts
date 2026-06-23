import { describe, expect, it } from "vitest";
import { isFetchNetworkError } from "./fetch-network-error.js";

describe("isFetchNetworkError", () => {
  it("matches Node fetch failures with network error causes", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });

    expect(isFetchNetworkError(err)).toBe(true);
  });

  it("matches generic fetch failure messages from browser runtimes", () => {
    expect(isFetchNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isFetchNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(
      isFetchNetworkError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
  });

  it("does not match ordinary errors or aborts", () => {
    expect(isFetchNetworkError(new Error("boom"))).toBe(false);
    expect(isFetchNetworkError(new DOMException("aborted", "AbortError"))).toBe(
      false,
    );
  });
});
