import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { resolveOwningPackage } from "./create-project.js";
import {
  renderScaffoldFiles,
  scaffoldProjectFromOptions,
} from "./render-scaffold.js";

describe("resolveOwningPackage", () => {
  it("reads @sapporta/server metadata without resolving its ESM-only root export", () => {
    const requireFromHere = createRequire(import.meta.url);

    expect(() => requireFromHere.resolve("@sapporta/server")).toThrow(
      /No "exports" main defined|Package subpath '\.' is not defined/,
    );
    expect(
      resolveOwningPackage(import.meta.url, "@sapporta/server").packageJson,
    ).toMatchObject({
      name: "@sapporta/server",
    });
  });
});

describe("renderScaffoldFiles", () => {
  it("replaces scaffold placeholders in generated project files", () => {
    const project = scaffoldProjectFromOptions({
      dir: "/tmp/acme-app",
      name: "Acme App",
    });
    const files = renderScaffoldFiles(project, undefined);
    const byDest = new Map(files.map((file) => [file.dest, file.content]));
    const unresolvedToken = /__(?!PURE__)[A-Z0-9_]+__/;

    expect(byDest.get("README.md")).toContain("# Acme App");
    expect(byDest.get("package.json")).toContain('"name": "Acme App"');
    expect(byDest.get(".env.development")).toMatch(
      /BETTER_AUTH_SECRET=[A-Za-z0-9_-]{43}/,
    );

    for (const file of files) {
      expect(file.content, file.dest).not.toMatch(unresolvedToken);
    }
  });
});
