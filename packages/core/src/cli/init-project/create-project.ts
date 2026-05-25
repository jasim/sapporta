import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fromProjectRoot } from "../../project-paths.js";
import { ensureBetterSqlite3Loads } from "./sqlite-native-repair.js";
import {
  initProjectPackagePaths,
  devMode_sapportaSourcePackageLinkSpec,
  devMode_sapportaSourcePackageJsonPath,
} from "./paths.js";

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
};

type ScaffoldProject = {
  root: string;
  name: string;
  slug: string;
  packageJsonPath: string;
  apiDir: string;
  frontendDir: string;
  sharedDir: string;
};

type ScaffoldPackages = {
  core: PackageJson & { dependencies: Record<string, string> };
  ui: PackageJson;
  grid: PackageJson;
  frontend: PackageJson;
  shared: PackageJson & { dependencies: Record<string, string> };
  specs: {
    core: string;
    ui: string;
    grid: string;
    frontend: string;
    shared: string;
  };
  pnpmOverrides?: Record<string, string>;
};

const SCAFFOLD_FILES: Array<{ src: string; dest: string } | string> = [
  "packages/api/boot.ts",
  "packages/api/app.ts",
  "packages/api/app/hello.ts",
  "packages/api/package.json",
  "packages/api/tsconfig.json",
  "package.json",
  "pnpm-workspace.yaml",
  "README.md",
  "DEPLOYMENT.md",
  { src: "gitignore", dest: ".gitignore" },
  "packages/frontend/package.json",
  "packages/frontend/tsconfig.json",
  "packages/frontend/vite.config.ts",
  "packages/frontend/index.html",
  "packages/frontend/src/main.tsx",
  "packages/frontend/src/App.tsx",
  "packages/frontend/src/Sidebar.tsx",
  "packages/frontend/src/Welcome.tsx",
  "packages/frontend/src/api.ts",
  "packages/frontend/src/app.css",
  "packages/frontend/src/vite-env.d.ts",
  "packages/shared/package.json",
  "packages/shared/tsconfig.json",
  "packages/shared/src/index.ts",
  "packages/shared/src/contracts/index.ts",
  "packages/shared/src/contracts/hello.ts",
  "packages/shared/CLAUDE.md",
];

export interface CreateProjectOptions {
  /** Absolute path to the project root (containing sapporta.json). */
  dir: string;
  /** Project name for package.json. Defaults to the directory basename. */
  name?: string;
}

export interface CreateProjectResult {
  dir: string;
  name: string;
}

/**
 * Create a Sapporta code project: writes workspace package files, boot.ts,
 * app.ts, package.json, tsconfig.json from templates and installs dependencies.
 *
 * `dir` is the project root (containing sapporta.json). Backend code lives in
 * packages/api, with packages/frontend and packages/shared beside it.
 *
 * This is the SDK function — no CLI arg parsing, no OperationResult wrapping.
 *
 * Throws if package.json already exists in the target directory.
 */
export function createProject(opts: CreateProjectOptions): CreateProjectResult {
  const project = projectFromOptions(opts);
  const initPaths = initProjectPackagePaths();

  assertCanCreateProject(project);
  assertPnpmAvailable();

  const packages = resolveScaffoldPackages(
    initPaths,
    process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT,
  );
  const replacements = buildTemplateReplacements(project, packages);
  const files = buildScaffoldFiles(
    initPaths,
    replacements,
    packages.pnpmOverrides,
  );

  createScaffoldDirectories(project);
  writeScaffoldFiles(project.root, files);

  installWorkspace(project.root);
  ensureBetterSqlite3Loads(project.apiDir);

  return { dir: project.root, name: project.name };
}

function projectFromOptions(opts: CreateProjectOptions): ScaffoldProject {
  const { dir } = opts;
  const name = opts.name ?? dir.split("/").pop() ?? "sapporta-project";
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const { apiDir, frontendDir, sharedDir } = fromProjectRoot(dir);

  return {
    root: dir,
    name,
    slug,
    packageJsonPath: join(dir, "package.json"),
    apiDir,
    frontendDir,
    sharedDir,
  };
}

function assertCanCreateProject(project: ScaffoldProject): void {
  if (existsSync(project.packageJsonPath)) {
    throw new Error(`package.json already exists in ${project.root}`);
  }
}

function assertPnpmAvailable(): void {
  // pnpm is a hard requirement — the scaffold writes a pnpm-workspace.yaml
  // and root scripts that invoke `pnpm --filter ./packages/frontend`, neither of
  // which npm understands. Fail fast before touching the filesystem so the
  // user gets a clear error instead of a half-scaffolded directory.
  try {
    execSync("pnpm --version", { stdio: "ignore" });
  } catch {
    throw new Error(
      "pnpm is required to scaffold a Sapporta project (the scaffold uses a pnpm workspace). Install it from https://pnpm.io/installation and re-run `sapporta init`.",
    );
  }
}

function resolveScaffoldPackages(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  devModePackageRoot: string | undefined,
): ScaffoldPackages {
  // Resolve @sapporta/server and frontend package dependency specifiers:
  // - SAPPORTA_DEV_MODE_PACKAGE_ROOT set (dev/source tree) → link: symlink
  // - SAPPORTA_DEV_MODE_PACKAGE_ROOT absent (published CLI) → use version from own package.json
  const _require = createRequire(import.meta.url);

  // Dev-mode overrides for transitive `workspace:*` dependencies inside
  // linked Sapporta packages. The scaffold links @sapporta/server at the
  // project root and @sapporta/frontend in packages/frontend/package.json via `link:` specs,
  // but their own package.json files still point at monorepo siblings with
  // `workspace:*` (@sapporta/server -> @sapporta/honest/@sapporta/shared,
  // @sapporta/frontend -> @sapporta/ui/@sapporta/grid/@sapporta/shared). In the scaffolded workspace, pnpm
  // would otherwise look for those packages beside the user's app packages,
  // then fail with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
  // Pointing those package names back to the source checkout keeps dev installs
  // equivalent to the Sapporta monorepo install.
  //
  // Published mode does not need this: pnpm rewrites `workspace:*` during
  // packing/publishing, so consumers resolve normal version ranges from npm.
  if (devModePackageRoot) {
    const corePkgPath = devMode_sapportaSourcePackageJsonPath(
      devModePackageRoot,
      "core",
    );
    const core = readPackageJson(corePkgPath) as PackageJson & {
      dependencies: Record<string, string>;
    };

    const uiPkgPath = devMode_sapportaSourcePackageJsonPath(
      devModePackageRoot,
      "ui",
    );
    const ui = readPackageJson(uiPkgPath);

    const gridPkgPath = devMode_sapportaSourcePackageJsonPath(
      devModePackageRoot,
      "grid",
    );
    const grid = readPackageJson(gridPkgPath);

    const frontendPkgPath = devMode_sapportaSourcePackageJsonPath(
      devModePackageRoot,
      "frontend",
    );
    const frontend = readPackageJson(frontendPkgPath);

    const sharedPkgPath = devMode_sapportaSourcePackageJsonPath(
      devModePackageRoot,
      "shared",
    );
    const shared = readPackageJson(sharedPkgPath) as PackageJson & {
      dependencies: Record<string, string>;
    };

    return {
      core,
      ui,
      grid,
      frontend,
      shared,
      specs: {
        core: devMode_sapportaSourcePackageLinkSpec(devModePackageRoot, "core"),
        ui: devMode_sapportaSourcePackageLinkSpec(devModePackageRoot, "ui"),
        grid: devMode_sapportaSourcePackageLinkSpec(devModePackageRoot, "grid"),
        frontend: devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "frontend",
        ),
        shared: devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "shared",
        ),
      },
      pnpmOverrides: {
        "@sapporta/honest": devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "honest",
        ),
        "@sapporta/shared": devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "shared",
        ),
        "@sapporta/ui": devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "ui",
        ),
        "@sapporta/grid": devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "grid",
        ),
      },
    };
  }

  const corePkgPath = _require.resolve("@sapporta/server/package.json");
  const core = readPackageJson(corePkgPath) as PackageJson & {
    dependencies: Record<string, string>;
  };
  const ui = readVendoredSapportaPackage(initPaths, "@sapporta/ui");
  const grid = readVendoredSapportaPackage(initPaths, "@sapporta/grid");
  const frontend = readVendoredSapportaPackage(
    initPaths,
    "@sapporta/frontend",
  );
  const shared = readVendoredSapportaPackage(
    initPaths,
    "@sapporta/shared",
  ) as PackageJson & {
    dependencies: Record<string, string>;
  };

  // @sapporta packages used by the scaffold are pinned from vendored
  // package.json snapshots instead of dependency specifiers. Source-tree
  // package metadata contains `workspace:*`, while published metadata is
  // rewritten by pnpm; using package versions directly keeps scaffold output
  // independent of where the CLI is running from.
  return {
    core,
    ui,
    grid,
    frontend,
    shared,
    specs: {
      core: sapportaPackageSpec(core, "@sapporta/server"),
      ui: sapportaPackageSpec(ui, "@sapporta/ui"),
      grid: sapportaPackageSpec(grid, "@sapporta/grid"),
      frontend: sapportaPackageSpec(frontend, "@sapporta/frontend"),
      shared: sapportaPackageSpec(shared, "@sapporta/shared"),
    },
  };
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function sapportaPackageSpec(
  pkg: PackageJson,
  packageName: `@sapporta/${string}`,
): string {
  if (pkg.name !== packageName) {
    throw new Error(
      `Expected ${packageName} package metadata, got ${pkg.name ?? "unnamed package"}.`,
    );
  }
  if (!pkg.version) {
    throw new Error(
      `${packageName}'s package.json is missing version — cannot pin scaffolded dependencies.`,
    );
  }
  return `^${pkg.version}`;
}

function readVendoredSapportaPackage(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  packageName: `@sapporta/${string}`,
): PackageJson {
  const shortName = packageName.slice("@sapporta/".length);
  return readPackageJson(initPaths.vendoredPackageJsonPath(shortName));
}

function buildTemplateReplacements(
  project: ScaffoldProject,
  packages: ScaffoldPackages,
): Record<string, string> {
  const drizzleVersion = packages.core.dependencies["drizzle-orm"];
  const zodVersion = packages.core.dependencies["zod"];
  const sapportaRestCoreVersion =
    packages.core.dependencies["@sapporta/rest-core"];
  const temporalVersion = packages.shared.dependencies["@js-temporal/polyfill"];
  if (!temporalVersion) {
    throw new Error(
      '@sapporta/shared\'s package.json is missing "@js-temporal/polyfill" in dependencies — cannot pin scaffolded Temporal dependency.',
    );
  }

  // Peer-dep pins for the scaffolded frontend package. Sourced from the
  // admin frontend package's own package.json so they can't drift — whatever
  // version of react/vite/tailwind @sapporta/frontend was built against is what the scaffold
  // writes. Some of these live in dependencies, some in devDependencies
  // (e.g. @types/react); pickVersion() checks both in order.
  const frontendDeps = {
    ...(packages.frontend.dependencies ?? {}),
    ...(packages.frontend.devDependencies ?? {}),
  };
  function pickVersion(name: string): string {
    const v = frontendDeps[name];
    if (!v) {
      throw new Error(
        `@sapporta/frontend's package.json is missing "${name}" in dependencies/devDependencies — cannot pin scaffolded frontend to a coherent version.`,
      );
    }
    return v;
  }

  return {
    __SLUG__: project.slug,
    __NAME__: project.name,
    __CORE_SPEC__: packages.specs.core,
    __UI_SPEC__: packages.specs.ui,
    __GRID_SPEC__: packages.specs.grid,
    __FRONTEND_SPEC__: packages.specs.frontend,
    __SHARED_SPEC__: packages.specs.shared,
    __DRIZZLE_VERSION__: drizzleVersion,
    __ZOD_VERSION__: zodVersion,
    __SAPPORTA_REST_CORE_VERSION__: sapportaRestCoreVersion,
    __TEMPORAL_VERSION__: temporalVersion,
    __REACT_VERSION__: pickVersion("react"),
    __REACT_DOM_VERSION__: pickVersion("react-dom"),
    __REACT_ROUTER_VERSION__: pickVersion("react-router-dom"),
    __LUCIDE_REACT_VERSION__: pickVersion("lucide-react"),
    __VITE_VERSION__: pickVersion("vite"),
    __VITE_REACT_VERSION__: pickVersion("@vitejs/plugin-react"),
    __TAILWIND_VITE_VERSION__: pickVersion("@tailwindcss/vite"),
    __TAILWIND_VERSION__: pickVersion("tailwindcss"),
    __TYPES_REACT_VERSION__: pickVersion("@types/react"),
    __TYPES_REACT_DOM_VERSION__: pickVersion("@types/react-dom"),
  };
}

function createScaffoldDirectories(project: ScaffoldProject): void {
  mkdirSync(project.apiDir, { recursive: true });
  mkdirSync(join(project.apiDir, "app"), { recursive: true });
  mkdirSync(join(project.apiDir, "schema"), { recursive: true });
  mkdirSync(join(project.apiDir, "reports"), { recursive: true });
  mkdirSync(join(project.frontendDir, "src"), { recursive: true });
  mkdirSync(join(project.sharedDir, "src", "contracts"), { recursive: true });
}

function buildScaffoldFiles(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  replacements: Record<string, string>,
  pnpmOverrides: Record<string, string> | undefined,
): Array<{ dest: string; content: string }> {
  return SCAFFOLD_FILES.map((file) => {
    const { src, dest } =
      typeof file === "string" ? { src: file, dest: file } : file;
    let content = renderTemplate(initPaths, src, replacements);
    if (dest === "package.json" && pnpmOverrides) {
      content = addPnpmOverrides(content, pnpmOverrides);
    }
    return { dest, content };
  });
}

function renderTemplate(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  filename: string,
  replacements: Record<string, string>,
): string {
  let content = readFileSync(initPaths.templatePath(filename), "utf-8");
  for (const [token, value] of Object.entries(replacements)) {
    content = content.replaceAll(token, value);
  }
  return content;
}

function addPnpmOverrides(
  rootPackageJson: string,
  pnpmOverrides: Record<string, string>,
): string {
  // package.json is parse-mutate-write rather than raw template-write because
  // pnpm.overrides is conditional on dev mode.
  const pkg = JSON.parse(rootPackageJson);
  pkg.pnpm = pkg.pnpm ?? {};
  pkg.pnpm.overrides = { ...(pkg.pnpm.overrides ?? {}), ...pnpmOverrides };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function writeScaffoldFiles(
  projectRoot: string,
  files: Array<{ dest: string; content: string }>,
): void {
  for (const file of files) {
    writeFileSync(join(projectRoot, file.dest), file.content);
  }
}

function installWorkspace(projectRoot: string): void {
  // pnpm presence was verified at the top of this function, so this is
  // guaranteed to resolve. One pass installs the root workspace.
  execSync("pnpm install", { cwd: projectRoot, stdio: "inherit" });
}
