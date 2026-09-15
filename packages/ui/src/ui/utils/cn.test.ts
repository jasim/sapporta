import { describe, expect, it } from "vitest";
import { cn, extendCn } from "./cn";

/**
 * tailwind-merge only knows Tailwind's stock theme. Every size Sapporta adds
 * through `@theme` has to be registered with it, or `text-sap-body` is read
 * as a text colour and conflicts with the real colour beside it.
 */
describe("cn", () => {
  it("keeps a Sapporta size next to a colour", () => {
    expect(cn("text-sap-body", "text-sap-fg")).toBe(
      "text-sap-body text-sap-fg",
    );
    expect(cn("text-sap-fg", "text-sap-body")).toBe(
      "text-sap-fg text-sap-body",
    );
  });

  it("lets a later Sapporta size replace an earlier one", () => {
    expect(cn("text-sap-body", "text-sap-data")).toBe("text-sap-data");
    expect(cn("text-sm", "text-sap-emph")).toBe("text-sap-emph");
    expect(cn("text-sap-emph", "text-sm")).toBe("text-sm");
  });

  it("still resolves colour conflicts", () => {
    expect(cn("text-sap-fg", "text-sap-soft")).toBe("text-sap-soft");
  });

  it("merges Sapporta heights and tracking with the stock scales", () => {
    expect(cn("h-9", "h-sap-ctl")).toBe("h-sap-ctl");
    expect(cn("h-sap-ctl", "h-9")).toBe("h-9");
    expect(cn("min-h-sap-row", "min-h-10")).toBe("min-h-10");
    expect(cn("tracking-tight", "tracking-sap-head")).toBe("tracking-sap-head");
  });

  it("learns an app's own scales through extendCn", () => {
    // Unregistered, `text-body` looks like a colour and displaces the real one.
    expect(cn("text-body", "text-sap-fg")).toBe("text-sap-fg");

    extendCn({ text: ["body", "title"], spacing: ["control"] });

    expect(cn("text-body", "text-sap-fg")).toBe("text-body text-sap-fg");
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-sap-body", "text-title")).toBe("text-title");
    expect(cn("h-9", "h-control")).toBe("h-control");
    // Earlier registrations survive a later call.
    expect(cn("text-sap-body", "text-sap-fg")).toBe(
      "text-sap-body text-sap-fg",
    );
  });
});
