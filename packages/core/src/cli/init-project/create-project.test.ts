import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorCode, OperationError } from "../../introspect/types.js";
import { createProject } from "./create-project.js";
import { DEPENDENCY_CATALOG } from "./dependency-catalog.js";
import type { InitCommandRunner } from "./init-shell.js";
import { resolveOwningPackage } from "./package-metadata.js";
import { initProjectPackagePaths } from "./paths.js";
import { layoutForRoot, projectIdentityFromOptions } from "./project-layout.js";
import { renderScaffoldFiles } from "./render-scaffold.js";
import {
  SCAFFOLD_MANIFEST,
  validateTemplateInventory,
} from "./scaffold-manifest.js";

describe("resolveOwningPackage", () => {
  it("reads @sapporta/server metadata without resolving its ESM-only root export", () => {
    expect(nativeRequireResolveError("@sapporta/server")).toMatch(
      /No "exports" main defined|Package subpath '\.' is not defined/,
    );
    expect(
      resolveOwningPackage(import.meta.url, "@sapporta/server").packageJson,
    ).toMatchObject({
      name: "@sapporta/server",
    });
  });
});

function nativeRequireResolveError(packageName: string): string {
  const script = `
    const { createRequire } = require("node:module");
    const requireFromHere = createRequire(${JSON.stringify(import.meta.url)});
    try {
      requireFromHere.resolve(${JSON.stringify(packageName)});
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;

  try {
    execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error(`Expected native require.resolve(${packageName}) to fail`);
}

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

  it("checks registry access before resolving scaffold packages", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const previousDevModePackageRoot =
      process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT;
    const runCommand = commandRunnerThatFails((command, args) => {
      if (command === "pnpm" && args[0] === "view") {
        return new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
      }
      return undefined;
    });

    process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT = join(
      parent,
      "missing-sapporta-checkout",
    );
    try {
      expect(() =>
        createProject({
          dir: target,
          name: "acme-app",
          runCommand,
          verifySqlite: noopSqliteVerifier,
        }),
      ).toThrow(/minimal package lookup/);
    } finally {
      if (previousDevModePackageRoot === undefined) {
        delete process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT;
      } else {
        process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT = previousDevModePackageRoot;
      }
    }

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

  it("cleans staging and leaves the target absent when the initial commit fails", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const runCommand = commandRunnerThatFails((command, args) => {
      if (command === "git" && args[0] === "commit") {
        return new Error("missing git identity");
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
    ).toThrow(/initial Git commit/);

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
    expect(commands[0]).toBe("pnpm --version");
    expect(commands[1]).toBe("pnpm view hono@latest version --json");
    expect(commands).toContain("pnpm install");
    expect(commands).toContain(
      "pnpm --filter ./packages/api db:generate --name initial_auth",
    );
    expect(commands).toContain("pnpm --filter ./packages/api db:migrate");
    const migrationApplyIndex = commands.indexOf(
      "pnpm --filter ./packages/api db:migrate",
    );
    expect(
      commands.slice(migrationApplyIndex + 1, migrationApplyIndex + 4),
    ).toEqual([
      "git init",
      "git add .",
      "git commit -m Create Sapporta project",
    ]);
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
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const files = renderScaffoldFiles(project, undefined);
    const byDest = new Map(files.map((file) => [file.dest, file.content]));
    const unresolvedToken = /%%SAPPORTA:[A-Z0-9_]+%%/;

    expect(byDest.get("README.md")).toContain("# Acme App");
    expect(byDest.get("README.md")).toContain("Uses [Sapporta]");
    expect(byDest.get("AGENTS.md")).toContain("shadcn/ui conventions");
    expect(byDest.get("AGENTS.md")).toContain("The `/api/hello` example");
    expect(byDest.get("AGENTS.md")).toContain("createSapportaMailer()");
    expect(byDest.get("CLAUDE.md")).toBe(
      "Please read the instructions in AGENTS.md.\n",
    );
    expect(byDest.has("packages/shared/AGENTS.md")).toBe(true);
    expect(byDest.get("packages/shared/package.json")).toMatch(
      /"@sapporta\/shared": "\^?\d+\.\d+\.\d+"/,
    );
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

  it("renders shared library dependency for dev-root scaffolds", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const files = renderScaffoldFiles(project, process.cwd());
    const byDest = new Map(files.map((file) => [file.dest, file.content]));

    expect(byDest.get("packages/shared/package.json")).toContain(
      `"@sapporta/shared": "link://${process.cwd()}/packages/shared"`,
    );
  });
});

describe("scaffold template inventory", () => {
  it("accounts for every template file as scaffolded or intentionally ignored", () => {
    const initPaths = initProjectPackagePaths();
    const templatePaths = listTemplateFiles(initPaths.templatesDir);

    expect(
      validateTemplateInventory(templatePaths, SCAFFOLD_MANIFEST, [
        "authz/types.ts",
        "packages/api/mailer.ts",
        "tsconfig.json",
        "dependency-package-snapshots/README.md",
        "dependency-package-snapshots/cli/package.json",
        "dependency-package-snapshots/frontend/package.json",
        "dependency-package-snapshots/grid/package.json",
        "dependency-package-snapshots/honest/package.json",
        "dependency-package-snapshots/shared/package.json",
        "dependency-package-snapshots/ui/package.json",
      ]),
    ).toEqual([]);
  });

  it("supplies every Sapporta template token used by scaffolded templates", () => {
    const initPaths = initProjectPackagePaths();
    const suppliedTokens = new Set([
      "%%SAPPORTA:SLUG%%",
      "%%SAPPORTA:NAME%%",
      "%%SAPPORTA:BETTER_AUTH_DEV_SECRET%%",
      ...DEPENDENCY_CATALOG.tokenByKey.values(),
    ]);
    const usedTokens = new Set(
      SCAFFOLD_MANIFEST.flatMap((file) =>
        [
          ...readFileSync(initPaths.templatePath(file.src), "utf-8").matchAll(
            /%%SAPPORTA:[A-Z0-9_]+%%/g,
          ),
        ].map((match) => match[0]),
      ),
    );

    expect(
      [...usedTokens].filter((token) => !suppliedTokens.has(token)),
    ).toEqual([]);
  });
});

function listTemplateFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };
  visit(root, "");
  return files.sort();
}
