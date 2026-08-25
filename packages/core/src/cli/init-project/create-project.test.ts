import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ErrorCode, OperationError } from "../../errors.js";
import { createProject, MINIMUM_PNPM_MAJOR_VERSION } from "./create-project.js";
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
  addPnpmOverrides,
  renderScaffoldTemplates,
} from "./template-rendering.js";
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

  it("rejects a pnpm older than the version that reads pnpm-workspace.yaml", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");

    let thrown: unknown;
    try {
      createProject({
        dir: target,
        name: "acme-app",
        runCommand: () => "10.18.0\n",
        verifySqlite: noopSqliteVerifier,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OperationError);
    expect((thrown as OperationError).code).toBe(ErrorCode.INIT_SETUP_FAILED);
    expect((thrown as OperationError).message).toContain(
      `Sapporta requires pnpm ${MINIMUM_PNPM_MAJOR_VERSION} or later; found 10.18.0.`,
    );
    expect(existsSync(target)).toBe(false);
    expect(stagingDirs(parent)).toEqual([]);
  });

  it("fails when the pnpm version cannot be read", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");

    expect(() =>
      createProject({
        dir: target,
        name: "acme-app",
        runCommand: () => "",
        verifySqlite: noopSqliteVerifier,
      }),
    ).toThrow(/Could not read the installed pnpm version/);
    expect(existsSync(target)).toBe(false);
  });

  it("publishes the target after all setup steps succeed", () => {
    const parent = makeTempDir();
    const target = join(parent, "acme-app");
    const commands: string[] = [];
    const runCommand: InitCommandRunner = (command, args) => {
      commands.push([command, ...args].join(" "));
      return commandOutput(command, args);
    };

    const result = createProject({
      dir: target,
      name: "Acme App",
      runCommand,
      verifySqlite: noopSqliteVerifier,
    });

    expect(result).toMatchObject({ dir: target, name: "Acme App" });
    // The ports `sapporta init` reports must be the ones it wrote.
    expect(readFileSync(join(target, ".env.development"), "utf-8")).toContain(
      `SAPPORTA_API_PORT=${result.devPorts.api}\nSAPPORTA_FRONTEND_PORT=${result.devPorts.frontend}\n`,
    );
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

const SUPPORTED_PNPM_VERSION = `${MINIMUM_PNPM_MAJOR_VERSION}.9.0`;

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
    return commandOutput(command, args);
  };
}

/** Only `pnpm --version` is read for its output; everything else ignores it. */
function commandOutput(command: string, args: readonly string[]): string {
  return command === "pnpm" && args[0] === "--version"
    ? `${SUPPORTED_PNPM_VERSION}\n`
    : "";
}

function noopSqliteVerifier(): void {
  return;
}

describe("pnpm override rendering", () => {
  const overrides = { "drizzle-orm": "0.45.2" };

  it("fails when no scaffold file can carry the resolved overrides", () => {
    expect(() =>
      renderScaffoldTemplates({
        templates: [
          {
            src: "package.json",
            dest: "package.json",
            ownership: "workspace",
            refreshPolicy: "merge-package-json",
            template: "{}\n",
          },
        ],
        variables: {},
        sourceLinkMode: true,
        pnpmOverrides: overrides,
      }),
    ).toThrow(/no pnpm-workspace.yaml entry to write them to/);
  });

  it("fails rather than append a second overrides key", () => {
    expect(() =>
      addPnpmOverrides("packages:\n  - packages/*\n\noverrides:\n", overrides),
    ).toThrow(/already declares "overrides"/);
  });
});

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
      "`VISUAL-DESIGN-GUIDELINES.md` governs how screens are designed",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "After writing a\nmajor change or addition",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "use a separate sub-agent or coding-agent thread",
    );
    expect(byDest.get("AGENTS.md")).toContain(
      "That review happens after the code is written",
    );
    expect(byDest.get("CODING-PRINCIPLES.md")).toContain("# Coding principles");
    expect(byDest.get("CODING-PRINCIPLES.md")).toContain(
      "input → parsed domain values → decisions → optional effect plan → I/O",
    );
    expect(byDest.get("VISUAL-DESIGN-GUIDELINES.md")).toContain(
      "# Compact Interface Design Guideline",
    );
    // AGENTS.md is a map, not a manual: every subject it names has to say
    // where the change goes and which published document owns the rules.
    expect(byDest.get("AGENTS.md")).toContain("The `/api/hello`");
    expect(byDest.get("AGENTS.md")).toContain("`packages/api/mailer.ts`");
    expect(byDest.get("AGENTS.md")).toContain(
      "Resolve one from the workspace\n  package that declares it",
    );
    expect(byDest.get("AGENTS.md")).toContain("node_modules/@sapporta");
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
    // Each project gets its own dev ports, so assert the shape and the one
    // rule that binds them: the public app URL is the origin the browser loads
    // the app from, which in development is Vite's.
    const devEnv = byDest.get(".env.development") ?? "";
    const frontendPort = devEnv.match(/SAPPORTA_FRONTEND_PORT=(\d+)/)?.[1];
    expect(devEnv).toMatch(/SAPPORTA_API_PORT=3\d{3}\n/);
    expect(frontendPort).toBeDefined();
    expect(devEnv).toContain(
      `SAPPORTA_PUBLIC_APP_URL=http://localhost:${frontendPort}`,
    );
    expect(byDest.get("README.md")).toContain(
      `\`http://localhost:${frontendPort}\``,
    );
    // Deployments bind one local port behind a proxy; that stays conventional.
    expect(byDest.get(".env.production.example")).toContain(
      "SAPPORTA_API_PORT=3000",
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
    expect(byDest.get("packages/frontend/src/App.tsx")).toContain(
      "export const appPublicHomeRoute",
    );
    expect(byDest.get("packages/frontend/src/Home.tsx")).toContain(
      "export function Home()",
    );
    // `/` opens a screen, so it has to render behind the gate: a home page
    // outside it would load for visitors without a session.
    expect(byDest.get("packages/frontend/src/SapportaApp.tsx")).toMatch(
      /<Route element=\{<AuthGate \/>\}>\s*\{appPublicHomeRoute \? null : appHomeRoute\}/,
    );
    expect(byDest.get("packages/frontend/src/Home.tsx")).toContain(
      "<AppPage",
    );
    expect(byDest.get("packages/frontend/src/PublicPage.tsx")).toContain(
      "<AppPage",
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toMatch(
      /Other\s+screens can choose their own height and/,
    );
    expect(byDest.get("packages/frontend/src/App.tsx")).toMatch(
      /`AppShell`\s+keeps its sidebar control available/,
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

  it("wires a typecheck command through every workspace package", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const files = renderScaffoldFiles(project, undefined);
    const byDest = new Map(files.map((file) => [file.dest, file.content]));
    const scriptsOf = (dest: string): Record<string, string> =>
      (
        JSON.parse(byDest.get(dest) ?? "{}") as {
          scripts?: Record<string, string>;
        }
      ).scripts ?? {};

    // `vite build` strips types with esbuild and never typechecks, so the
    // frontend needs its own tsc pass to report type errors at all. Its
    // tsconfig maps acme-app-shared to ../shared/src, not ../shared/dist, so
    // unlike the API this pass needs no prior shared build.
    const frontendScripts = scriptsOf("packages/frontend/package.json");
    expect(frontendScripts.typecheck).toBe("tsc --noEmit");
    expect(frontendScripts.pretypecheck).toBeUndefined();
    expect(byDest.get("packages/frontend/tsconfig.json")).toContain(
      '"acme-app-shared": ["../shared/src/index.ts"]',
    );

    expect(scriptsOf("packages/shared/package.json").typecheck).toBe(
      "tsc --noEmit",
    );
    const apiScripts = scriptsOf("packages/api/package.json");
    expect(apiScripts.typecheck).toBe("tsc --noEmit");
    expect(apiScripts.pretypecheck).toBe("pnpm --filter acme-app-shared build");

    // Drizzle Kit reads the schema files, and a schema file may import the
    // shared package, so every command that loads the schema builds it first.
    // `db:migrate` and `db:check` read only drizzle.config.ts and the SQL in
    // migrations/, so a build there would be dead weight on the common path.
    for (const command of [
      "db:generate",
      "db:generate:custom",
      "db:studio",
    ] as const) {
      expect(apiScripts[`pre${command}`]).toBe(
        "pnpm --filter acme-app-shared build",
      );
    }
    expect(apiScripts["predb:migrate"]).toBeUndefined();
    expect(apiScripts["predb:check"]).toBeUndefined();

    const rootScripts = scriptsOf("package.json");
    expect(rootScripts.typecheck).toBe(
      "pnpm --filter ./packages/shared typecheck && " +
        "pnpm --filter ./packages/api typecheck && " +
        "pnpm --filter ./packages/frontend typecheck",
    );
    // `pnpm build` is the signal both humans and agents trust before calling
    // work done, so it must fail on type-broken frontend code.
    expect(rootScripts.build).toBe(
      "pnpm run typecheck && " +
        "pnpm --filter ./packages/shared build && " +
        "pnpm --filter ./packages/api build && " +
        "pnpm --filter ./packages/frontend build",
    );

    // The generated project has to name the command, or an agent has no way
    // to learn it exists.
    const agents = byDest.get("AGENTS.md") ?? "";
    expect(agents).toContain("`pnpm typecheck`");
    expect(agents).toContain("Typechecks shared, API, and frontend");
    expect(agents).toContain("Runs `typecheck`, then compiles all three");
    expect(byDest.get("README.md")).toContain(
      "- `pnpm typecheck` - typecheck the shared package, API, and frontend",
    );
  });

  it("keeps the shared package loadable by the tools that read schema files", () => {
    const project = layoutForRoot(
      projectIdentityFromOptions({
        dir: "/tmp/acme-app",
        name: "Acme App",
      }),
    );
    const files = renderScaffoldFiles(project, undefined);
    const byDest = new Map(files.map((file) => [file.dest, file.content]));

    // Drizzle Kit loads schema files with a CJS require, which matches neither
    // `types` nor `import`. Without a runtime condition it cannot resolve the
    // shared package at all and fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
    const sharedPackage = JSON.parse(
      byDest.get("packages/shared/package.json") ?? "{}",
    ) as { exports?: Record<string, unknown> };
    expect(sharedPackage.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });

    // A build that fails has to leave the last good dist alone. Emitting on
    // error writes re-exports of modules it never emitted, so the next command
    // that loads dist/ reports a missing file rather than the type error that
    // caused it.
    const sharedTsconfig = JSON.parse(
      byDest.get("packages/shared/tsconfig.json") ?? "{}",
    ) as { compilerOptions?: Record<string, unknown> };
    expect(sharedTsconfig.compilerOptions?.noEmitOnError).toBe(true);

    // Drizzle Kit honours tsconfig paths, so a mapping here would decide what
    // `db:generate` loads at runtime. The workspace symlink and the shared
    // package's own exports resolve the same types without that reach.
    const apiTsconfig = JSON.parse(
      byDest.get("packages/api/tsconfig.json") ?? "{}",
    ) as { compilerOptions?: Record<string, unknown> };
    expect(apiTsconfig.compilerOptions?.paths).toBeUndefined();
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

    // pnpm 11 reads overrides from pnpm-workspace.yaml and ignores the
    // root package.json `pnpm` field entirely.
    const rootPackage = JSON.parse(byDest.get("package.json") ?? "{}") as {
      pnpm?: { overrides?: Record<string, string> };
    };
    expect(rootPackage.pnpm?.overrides).toBeUndefined();
    const workspaceYaml = byDest.get("pnpm-workspace.yaml") ?? "";
    const overrides = parseWorkspaceOverrides(workspaceYaml);
    expect(Object.keys(overrides)).toEqual([
      "@sapporta/honest",
      "@sapporta/shared",
      "@sapporta/ui",
      "@sapporta/grid",
      "better-sqlite3",
      "drizzle-orm",
      "@types/better-sqlite3",
      "kysely",
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
      "@types/better-sqlite3",
      "kysely",
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
    const files = renderScaffoldFiles(project, process.cwd(), {
      betterAuthDevSecret: "test-secret",
      gettingStartedEnv,
    });
    const home = files.find(
      (file) => file.dest === "packages/frontend/src/Home.tsx",
    )?.content;

    expect(home).toContain(
      '"http://127.0.0.1:4321/docs/getting-started/introduction/"',
    );
    expect(home).toContain(
      "http://127.0.0.1:4321/docs/getting-started/introduction.md",
    );
    expect(home).not.toContain("%%SAPPORTA:");
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
      "@types/better-sqlite3",
      "kysely",
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
        "tsconfig.json",
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
      "%%SAPPORTA:DEV_API_PORT%%",
      "%%SAPPORTA:DEV_FRONTEND_PORT%%",
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

function parseWorkspaceOverrides(workspaceYaml: string): {
  [packageName: string]: string;
} {
  const overrides: Record<string, string> = {};
  const section = workspaceYaml.split(/^overrides:$/m)[1];
  for (const line of (section ?? "").split("\n")) {
    const match = /^ {2}"([^"]+)": "([^"]+)"$/.exec(line);
    if (match) overrides[match[1]!] = match[2]!;
  }
  return overrides;
}

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
