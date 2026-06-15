import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorCode, OperationError } from "../../introspect/types.js";
import { createProject, resolveOwningPackage } from "./create-project.js";
import type { InitCommandRunner } from "./init-commands.js";
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

describe("createProject", () => {
  it("fails registry preflight before writing the target", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const runCommand = commandRunnerThatFails((command, args) => {
      if (command === "pnpm" && args[0] === "view") {
        return new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
      }
      return undefined;
    });

    let thrown: unknown;
    try {
      createProject({
        dir: target,
        name: "acme-app",
        runCommand,
        verifySqlite: noopSqliteVerifier,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OperationError);
    expect((thrown as OperationError).code).toBe(
      ErrorCode.INIT_NPM_REGISTRY_UNAVAILABLE,
    );
    expect((thrown as OperationError).message).toContain(
      "Retry the full `sapporta init acme-app` command with network/npm-registry access.",
    );
    expect(existsSync(target)).toBe(false);
    expect(stagingDirs(parent)).toEqual([]);
  });

  it("cleans staging and leaves the target absent when install fails", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const runCommand = commandRunnerThatFails((command, args) => {
      if (command === "pnpm" && args[0] === "install") {
        return new Error("install failed");
      }
      return undefined;
    });

    expect(() =>
      createProject({
        dir: target,
        name: "acme-app",
        runCommand,
        verifySqlite: noopSqliteVerifier,
      }),
    ).toThrow(/dependency installation/);

    expect(existsSync(target)).toBe(false);
    expect(stagingDirs(parent)).toEqual([]);
  });

  it("publishes the target after all setup steps succeed", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const commands: string[] = [];
    const runCommand: InitCommandRunner = (command, args) => {
      commands.push([command, ...args].join(" "));
    };

    const result = createProject({
      dir: target,
      name: "Acme App",
      runCommand,
      verifySqlite: noopSqliteVerifier,
    });

    expect(result).toEqual({ dir: target, name: "Acme App" });
    expect(stagingDirs(parent)).toEqual([]);
    expect(readFileSync(join(target, "sapporta.json"), "utf-8")).toBe(
      '{\n  "name": "Acme App"\n}\n',
    );
    expect(existsSync(join(target, "data"))).toBe(true);
    expect(existsSync(join(target, "packages/api/package.json"))).toBe(true);
    expect(commands).toContain("pnpm --version");
    expect(commands).toContainEqual(
      expect.stringMatching(/^pnpm view hono@.+ version --json$/),
    );
    expect(commands).toContain("pnpm install");
    expect(commands).toContain(
      "pnpm --filter ./packages/api db:generate --name initial_auth",
    );
    expect(commands).toContain("pnpm --filter ./packages/api db:migrate");
  });
});

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sapporta-create-project-"));
}

function stagingDirs(parent: string): string[] {
  return readdirSync(parent).filter((name) => name.includes(".sapporta-init-"));
}

function commandRunnerThatFails(
  fail: (command: string, args: readonly string[]) => Error | undefined,
): InitCommandRunner {
  return (command, args) => {
    const error = fail(command, args);
    if (error) throw error;
  };
}

function noopSqliteVerifier(): void {
  return;
}

describe("renderScaffoldFiles", () => {
  it("replaces scaffold placeholders in generated project files", () => {
    const project = scaffoldProjectFromOptions({
      dir: "/tmp/acme-app",
      name: "Acme App",
    });
    const files = renderScaffoldFiles(project, undefined);
    const byDest = new Map(files.map((file) => [file.dest, file.content]));
    const unresolvedToken = /%%SAPPORTA:[A-Z0-9_]+%%/;

    expect(byDest.get("README.md")).toContain("# Acme App");
    expect(byDest.get("package.json")).toContain('"name": "Acme App"');
    expect(byDest.get(".env.development")).toMatch(
      /BETTER_AUTH_SECRET=[A-Za-z0-9_-]{43}/,
    );
    expect(byDest.get(".env.development")).toContain(
      "SAPPORTA_PUBLIC_BASE_URL=http://localhost:5173",
    );
    expect(byDest.has("packages/frontend/src/SapportaApp.tsx")).toBe(true);
    expect(byDest.has("packages/frontend/src/Sidebar.tsx")).toBe(false);
    expect(byDest.get("packages/frontend/src/main.tsx")).toContain(
      'import { SapportaApp } from "./SapportaApp";',
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "export const appPublicRoutes",
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "export const appProtectedRoutes",
    );
    expect(byDest.get("packages/api/app.ts")).toContain(
      'path: "/api/public-api-sample"',
    );
    expect(byDest.get("packages/api/app/public-api-sample.ts")).toContain(
      'auth.ability.can("read", "public_api_sample")',
    );
    expect(byDest.get("packages/api/authz/ability.ts")).toContain(
      'can("read", "public_api_sample")',
    );

    for (const file of files) {
      expect(file.content, file.dest).not.toMatch(unresolvedToken);
    }
  });
});
