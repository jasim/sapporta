import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorCode, OperationError } from "../../errors.js";
import { createProject } from "./create-project.js";
import {
  DEPENDENCY_CATALOG,
  sharedRuntimeDefinitions,
} from "./dependency-catalog.js";
import type { InitCommandRunner } from "./init-shell.js";
import { resolveGettingStartedEnv } from "./getting-started-env.js";
import { resolveOwningPackage } from "./package-metadata.js";
import { initProjectPackagePaths } from "./paths.js";
import { layoutForRoot, projectIdentityFromOptions } from "./project-layout.js";
import { renderScaffoldFiles } from "./render-scaffold.js";
import {
  SCAFFOLD_MANIFEST,
  validateTemplateInventory,
} from "./scaffold-manifest.js";

describe("resolveOwningPackage", () => {
  it("reads @sapporta/server metadata from the module location", () => {
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

  it("checks registry access before resolving scaffold packages", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const previousPackageRoot = process.env.SAPPORTA_PACKAGE_ROOT;
    const runCommand = commandRunnerThatFails((command, args) => {
      if (command === "pnpm" && args[0] === "view") {
        return new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
      }
      return undefined;
    });

    process.env.SAPPORTA_PACKAGE_ROOT = join(
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
      if (previousPackageRoot === undefined) {
        delete process.env.SAPPORTA_PACKAGE_ROOT;
      } else {
        process.env.SAPPORTA_PACKAGE_ROOT = previousPackageRoot;
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
    expect(
      readFileSync(
        join(target, "packages/api/project-auth/options.ts"),
        "utf-8",
      ),
    ).toMatch(/projectAuthCookiePrefix = "sapporta-acme-app-[a-f0-9]{16}"/);
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
  it("keeps same-slug projects distinct with their generated cookie ids", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const authOptions = (files: ReturnType<typeof renderScaffoldFiles>) =>
      files.find((file) => file.dest === "packages/api/project-auth/options.ts")
        ?.content;
    const first = authOptions(renderScaffoldFiles(project, undefined));
    const second = authOptions(renderScaffoldFiles(project, undefined));

    expect(first).toMatch(
      /projectAuthCookiePrefix = "sapporta-acme-app-[a-f0-9]{16}"/,
    );
    expect(second).toMatch(
      /projectAuthCookiePrefix = "sapporta-acme-app-[a-f0-9]{16}"/,
    );
    expect(first).not.toBe(second);
  });

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
    expect(byDest.get("AGENTS.md")).toContain(
      "follow `VISUAL-DESIGN-GUIDELINES.md`",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "After writing a major code change or addition",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "use a separate sub-agent or\ncoding-agent thread",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "must happen after the\ncode has been written",
    );
    expect(byDest.get("CODING-PRINCIPLES.md")).toContain("# Coding principles");
    expect(byDest.get("CODING-PRINCIPLES.md")).toContain(
      "input → parsed domain values → decisions → optional effect plan → I/O",
    );
    expect(byDest.get("VISUAL-DESIGN-GUIDELINES.md")).toContain(
      "# Compact Interface Design Guideline",
    );
    expect(byDest.get("AGENTS.md")).toContain("The `/api/hello` example");
    expect(byDest.get("AGENTS.md")).toContain("createSapportaMailer()");
    expect(byDest.get("AGENTS.md")).toContain("## Analytical questions");
    expect(byDest.get("AGENTS.md")).toContain("sapporta rows count");
    expect(byDest.get("AGENTS.md")).toContain("bounded grouped counts");
    expect(byDest.get("AGENTS.md")).toContain("application-owned report");
    expect(byDest.get("CLAUDE.md")).toBe(
      "Please read the instructions in AGENTS.md.\n",
    );
    expect(byDest.has("packages/shared/AGENTS.md")).toBe(true);
    expect(byDest.get("packages/shared/package.json")).toMatch(
      /"@sapporta\/shared": "\^?\d+\.\d+\.\d+"/,
    );
    expect(byDest.get("package.json")).toContain('"name": "Acme App"');
    expect(byDest.get("packages/api/project-auth/options.ts")).toMatch(
      /projectAuthCookiePrefix = "sapporta-acme-app-[a-f0-9]{16}"/,
    );
    expect(byDest.get("packages/api/project-auth/better-auth.ts")).toContain(
      "cookiePrefix: projectAuthCookiePrefix",
    );
    expect(byDest.get(".env.development")).toMatch(
      /BETTER_AUTH_SECRET=[A-Za-z0-9_-]{43}/,
    );
    expect(byDest.get(".env.development")).toContain("SAPPORTA_API_PORT=3000");
    expect(byDest.get(".env.development")).toContain(
      "SAPPORTA_FRONTEND_PORT=5173",
    );
    expect(byDest.get(".env.development")).toContain(
      "SAPPORTA_PUBLIC_APP_URL=http://localhost:5173",
    );
    expect(byDest.has("packages/frontend/src/SapportaApp.tsx")).toBe(true);
    expect(byDest.has("packages/frontend/src/Sidebar.tsx")).toBe(false);
    expect(byDest.get("packages/frontend/src/main.tsx")).toContain(
      'import { SapportaApp } from "./SapportaApp";',
    );
    expect(byDest.get("packages/frontend/src/main.tsx")).toContain(
      'import { QueryClientProvider } from "@tanstack/react-query";',
    );
    expect(byDest.get("packages/frontend/src/main.tsx")).toContain(
      'import { queryClient } from "./query-client";',
    );
    expect(byDest.get("packages/frontend/src/main.tsx")).toContain(
      "<QueryClientProvider client={queryClient}>",
    );
    expect(byDest.get("packages/frontend/src/main.tsx")).not.toContain(
      "new QueryClient(",
    );
    expect(byDest.get("packages/frontend/src/query-client.ts")).toContain(
      "export const queryClient = new QueryClient({",
    );
    const frontendPackage = JSON.parse(
      byDest.get("packages/frontend/package.json") ?? "{}",
    ) as { dependencies?: Record<string, string> };
    expect(frontendPackage.dependencies?.["@tanstack/react-query"]).toMatch(
      /^\^?\d+\.\d+\.\d+/,
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "export const appPublicRoutes",
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "export const appProtectedRoutes",
    );
    expect(byDest.get("packages/frontend/src/Welcome.tsx")).toContain(
      "<AppPage",
    );
    expect(byDest.get("packages/frontend/src/PublicPage.tsx")).toContain(
      "<AppPage",
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "Other screens can choose their own height and",
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "`AppShell` keeps its sidebar control available",
    );
    expect(byDest.get("packages/api/app.ts")).toContain(
      'path: "/api/public-api-sample"',
    );
    expect(byDest.get("packages/api/app/public-api-sample.ts")).toContain(
      'auth.ability.can("read", "public_api_sample")',
    );
    expect(byDest.has("packages/api/app/sample-report.ts")).toBe(false);
    expect(byDest.has("packages/shared/src/contracts/sample-report.ts")).toBe(
      false,
    );
    expect(byDest.has("packages/frontend/src/reports/SampleReport.tsx")).toBe(
      false,
    );
    expect(byDest.get("packages/api/authz/ability.ts")).toContain(
      'can("read", "public_api_sample")',
    );
    const viteConfig = byDest.get("packages/frontend/vite.config.ts");
    expect(viteConfig).not.toContain("preserveSymlinks");
    expect(viteConfig).not.toContain("dedupe:");
    // The scaffolder may explain its maintainer-only source-link policy, but
    // registry-generated application code must not expose that terminology.
    expect(viteConfig).not.toContain("VITE_SOURCE_LINK_RESOLUTION");
    expect(viteConfig).not.toContain("source-link");
    const apiPackage = JSON.parse(
      byDest.get("packages/api/package.json") ?? "{}",
    ) as { scripts?: Record<string, string> };
    expect(apiPackage.scripts?.dev).toContain(
      "node --env-file=../../.env.development --watch dist/boot.js",
    );
    expect(apiPackage.scripts?.start).toBe("node dist/boot.js");
    expect(apiPackage.scripts?.dev).not.toContain("--preserve-symlinks");
    expect(apiPackage.scripts?.start).not.toContain("--preserve-symlinks");

    for (const file of files) {
      expect(file.content, file.dest).not.toMatch(unresolvedToken);
    }
  });

  it("renders source-link dependencies, overrides, and resolver settings", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const files = renderScaffoldFiles(project, process.cwd());
    const byDest = new Map(files.map((file) => [file.dest, file.content]));

    expect(byDest.get("packages/shared/package.json")).toContain(
      `"@sapporta/shared": "link:${process.cwd()}/packages/shared"`,
    );
    const viteConfig = byDest.get("packages/frontend/vite.config.ts");
    expect(viteConfig).not.toContain("preserveSymlinks");
    expect(viteConfig).toContain("dedupe:");
    for (const definition of sharedRuntimeDefinitions("browser")) {
      expect(viteConfig).toContain(JSON.stringify(definition.packageName));
    }
    // Source-linked output receives the concrete resolver setting only. The
    // framework-development rationale belongs in the renderer, not the app.
    expect(viteConfig).not.toContain("VITE_SOURCE_LINK_RESOLUTION");
    expect(viteConfig).not.toContain("source-link");

    const apiPackage = JSON.parse(
      byDest.get("packages/api/package.json") ?? "{}",
    ) as { scripts?: Record<string, string> };
    expect(apiPackage.scripts?.dev).toContain(
      "node --import @sapporta/server/source-link-runtime --env-file=../../.env.development --watch dist/boot.js",
    );
    expect(apiPackage.scripts?.start).toBe(
      "node --import @sapporta/server/source-link-runtime dist/boot.js",
    );

    const rootPackage = JSON.parse(byDest.get("package.json") ?? "{}") as {
      pnpm?: { overrides?: Record<string, string> };
    };
    const overrides = rootPackage.pnpm?.overrides ?? {};
    expect(Object.keys(overrides)).toEqual([
      "@sapporta/honest",
      "@sapporta/shared",
      "@sapporta/ui",
      "@sapporta/grid",
      "better-sqlite3",
      "drizzle-orm",
      "hono",
      "@sapporta/rest-core",
      "@tanstack/react-form",
      "@tanstack/react-query",
      "@js-temporal/polyfill",
      "zod",
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
    ]);
    for (const packageName of [
      "better-sqlite3",
      "drizzle-orm",
      "hono",
      "@sapporta/rest-core",
      "@tanstack/react-form",
      "@tanstack/react-query",
      "@js-temporal/polyfill",
      "zod",
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
    ]) {
      expect(overrides[packageName], packageName).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("renders configured documentation URLs into starter prompts", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const gettingStartedEnv = resolveGettingStartedEnv({
      SAPPORTA_DOCS_ORIGIN: "http://127.0.0.1:4321",
    });
    const files = renderScaffoldFiles(
      project,
      process.cwd(),
      "test-secret",
      gettingStartedEnv,
    );
    const welcome = files.find(
      (file) => file.dest === "packages/frontend/src/Welcome.tsx",
    )?.content;

    expect(welcome).toContain(
      '"http://127.0.0.1:4321/docs/getting-started/introduction/"',
    );
    expect(welcome).toContain(
      "http://127.0.0.1:4321/docs/getting-started/introduction.md",
    );
    expect(welcome).not.toContain("%%SAPPORTA:");
  });
});

describe("shared runtime dependency catalog", () => {
  it("selects complete definitions in catalog order for each scope", () => {
    expect(
      sharedRuntimeDefinitions("browser").map(
        (definition) => definition.packageName,
      ),
    ).toEqual([
      "@sapporta/rest-core",
      "@tanstack/react-form",
      "@tanstack/react-query",
      "@js-temporal/polyfill",
      "zod",
      "react",
      "react-dom",
      "react-router-dom",
      "zustand",
    ]);
    expect(
      sharedRuntimeDefinitions("server").map(
        (definition) => definition.packageName,
      ),
    ).toEqual([
      "better-sqlite3",
      "drizzle-orm",
      "hono",
      "@sapporta/rest-core",
      "@js-temporal/polyfill",
      "zod",
    ]);
    for (const definition of DEPENDENCY_CATALOG.definitions) {
      expect(typeof definition.sharedRuntime.browser).toBe("boolean");
      expect(typeof definition.sharedRuntime.server).toBe("boolean");
    }
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
    const handledTokens = new Set([
      "%%SAPPORTA:SLUG%%",
      "%%SAPPORTA:NAME%%",
      "%%SAPPORTA:AUTH_COOKIE_PREFIX%%",
      "%%SAPPORTA:BETTER_AUTH_DEV_SECRET%%",
      "%%SAPPORTA:DOCS_BROWSER_URL%%",
      "%%SAPPORTA:DOCS_AGENT_URL%%",
      "%%SAPPORTA:NODE_COMMAND%%",
      "%%SAPPORTA:VITE_SOURCE_LINK_RESOLUTION%%",
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
      [...usedTokens].filter((token) => !handledTokens.has(token)),
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
