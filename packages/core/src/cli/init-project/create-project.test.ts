import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { resolveOwningPackage } from "./create-project.js";

describe("resolveOwningPackage", () => {
  it("reads @sapporta/server metadata without resolving its ESM-only root export", () => {
    const requireFromHere = createRequire(import.meta.url);

    expect(() => requireFromHere.resolve("@sapporta/server")).toThrow(
      /No "exports" main defined|Package subpath '\.' is not defined/,
    );
    expect(resolveOwningPackage(import.meta.url, "@sapporta/server").packageJson)
      .toMatchObject({
        name: "@sapporta/server",
      });
  });
});
