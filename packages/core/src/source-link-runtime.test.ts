import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const RUNTIME = join(import.meta.dirname, "source-link-runtime.ts");
const SAPPORTA_SOURCE_FILE = join(
  import.meta.dirname,
  "test-fixtures",
  "source-link",
  "import-application-dependency.mjs",
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * A project whose only package.json is the root one, with the entry script
 * `entry` directories below it.
 */
function makeFlatProject(entry: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "sapporta-source-link-"));
  roots.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "flat-app",
      type: "module",
      dependencies: { "sapporta-source-link-sample": "1.0.0" },
    }),
  );
  const dependency = join(root, "node_modules", "sapporta-source-link-sample");
  mkdirSync(dependency, { recursive: true });
  writeFileSync(
    join(dependency, "package.json"),
    JSON.stringify({
      name: "sapporta-source-link-sample",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }),
  );
  writeFileSync(
    join(dependency, "index.js"),
    'export default "from the application";\n',
  );

  const entryPath = join(root, ...entry);
  mkdirSync(join(entryPath, ".."), { recursive: true });
  writeFileSync(
    entryPath,
    `import value from ${JSON.stringify(pathToFileURL(SAPPORTA_SOURCE_FILE).href)};\n` +
      "console.log(value);\n",
  );
  return entryPath;
}

function runWithRuntime(entryPath: string): string {
  return execFileSync(process.execPath, ["--import", RUNTIME, entryPath], {
    // The entry script decides which package.json is used, not the working
    // directory.
    cwd: tmpdir(),
    encoding: "utf-8",
  }).trim();
}

describe("source-link runtime in a project with one package.json", () => {
  it("resolves Sapporta's imports from the root package.json", () => {
    expect(runWithRuntime(makeFlatProject(["boot.js"]))).toBe(
      "from the application",
    );
  });

  it("finds the root package.json from an entry script below it", () => {
    expect(runWithRuntime(makeFlatProject(["dist", "server", "boot.js"]))).toBe(
      "from the application",
    );
  });
});
