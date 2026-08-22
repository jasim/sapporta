import { describe, expect, it } from "vitest";
import { safeRedirectPath, signInRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectPath("/orders?status=open")).toBe("/orders?status=open");
  });

  it("falls back to the home page for a path that leaves the app", () => {
    expect(safeRedirectPath("//example.test")).toBe("/");
    expect(safeRedirectPath("https://example.test")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
  });
});

describe("signInRedirectPath", () => {
  it("returns the page the visitor asked for", () => {
    expect(
      signInRedirectPath({
        from: { pathname: "/orders/42", search: "?tab=lines", hash: "#total" },
      }),
    ).toBe("/orders/42?tab=lines#total");
  });

  it("returns the home page when no page was recorded", () => {
    expect(signInRedirectPath(undefined)).toBe("/");
    expect(signInRedirectPath({})).toBe("/");
    expect(signInRedirectPath({ from: "/orders" })).toBe("/");
  });

  it("refuses a recorded page that leaves the app", () => {
    expect(signInRedirectPath({ from: { pathname: "//example.test" } })).toBe(
      "/",
    );
  });
});
