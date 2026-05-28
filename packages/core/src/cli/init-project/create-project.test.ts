import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("project scaffold migration conventions", () => {
  it("keeps native Drizzle Kit scripts in the API package template", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../templates/packages/api/package.json"),
        "utf-8",
      ),
    ) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(pkg.scripts["db:generate"]).toBe("drizzle-kit generate");
    expect(pkg.scripts["db:generate:custom"]).toBe("drizzle-kit generate --custom");
    expect(pkg.scripts["db:migrate"]).toBe("drizzle-kit migrate");
    expect(pkg.scripts["db:check"]).toBe("drizzle-kit check");
    expect(pkg.devDependencies["drizzle-kit"]).toBe("__DRIZZLE_KIT_VERSION__");
  });

  it("points Drizzle Kit directly at project schema files", () => {
    const config = readFileSync(
      join(import.meta.dirname, "../../templates/packages/api/drizzle.config.ts"),
      "utf-8",
    );

    expect(config).toContain('schema: "./schema/**/*.ts"');
    expect(config).toContain('out: "./migrations"');
    expect(config).not.toContain("migrations:");
  });
});
