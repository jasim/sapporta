import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
  peerDependencies?: Record<string, string>;
  version?: string;
};

type PackageMetadata = {
  packageJsonPath: string;
  packageJson: PackageJson;
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
  core: PackageJson;
  honest: PackageJson;
  ui: PackageJson;
  grid: PackageJson;
  frontend: PackageJson;
  shared: PackageJson;
  specs: {
    core: string;
    honest: string;
    ui: string;
    grid: string;
    frontend: string;
    shared: string;
    betterSqlite3: string;
    drizzle: string;
    drizzleKit: string;
    hono: string;
    honoNodeServer: string;
    restCore: string;
    temporal: string;
    zod: string;
    react: string;
    reactDom: string;
    reactRouter: string;
    lucideReact: string;
    vite: string;
    viteReact: string;
    tailwindVite: string;
    tailwind: string;
    typesReact: string;
    typesReactDom: string;
    zustand: string;
  };
  pnpmOverrides?: Record<string, string>;
};

type ProgressLogger = (message: string) => void;

const noopProgress: ProgressLogger = () => {};

const DEV_MODE_IDENTITY_PACKAGES = [
  "hono",
  "drizzle-orm",
  "better-sqlite3",
  "zod",
  "@sapporta/rest-core",
  "@js-temporal/polyfill",
  "react",
  "react-dom",
  "react-router-dom",
  "zustand",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-dialog",
  "@radix-ui/react-label",
  "@radix-ui/react-popover",
  "@radix-ui/react-select",
  "@radix-ui/react-switch",
] as const;

const SCAFFOLD_FILES: Array<{ src: string; dest: string } | string> = [
  "packages/api/boot.ts",
  "packages/api/drizzle.config.ts",
  "packages/api/app.ts",
  "packages/api/app/hello.ts",
  "packages/api/package.json",
  "packages/api/tsconfig.json",
  "package.json",
  "pnpm-workspace.yaml",
  "Dockerfile",
  ".dockerignore",
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
  /** Optional hook for CLI progress messages while long-running setup runs. */
  progress?: ProgressLogger;
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
  const progress = opts.progress ?? noopProgress;
  const project = projectFromOptions(opts);
  const initPaths = initProjectPackagePaths();

  progress(`Preparing Sapporta project in ${project.root}...`);
  assertCanCreateProject(project);
  progress("Checking pnpm is available...");
  assertPnpmAvailable();

  progress("Resolving Sapporta package versions...");
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

  progress("Creating workspace directories...");
  createScaffoldDirectories(project);
  progress("Writing project files...");
  writeScaffoldFiles(project.root, files);

  installWorkspace(project.root, progress);
  ensureBetterSqlite3Loads(project.apiDir, progress);

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
  // Resolve the package metadata and dependency specifiers that the generated
  // workspace writes into its package.json files. Sapporta packages are linked
  // to source packages in dev mode and versioned from package metadata in
  // published mode; third-party runtime packages follow the mode-specific
  // rules below so the generated API and @sapporta/server share one runtime
  // dependency graph.
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
    // Dev mode links the generated project directly to this source checkout.
    // Source package metadata is read from the known monorepo package.json
    // files, not through package entrypoints: the scaffold may run before a
    // package has been built, so `exports` targets under dist/ are not a stable
    // discovery mechanism for Sapporta source packages.
    const coreMetadata = readDevModeSapportaPackage(devModePackageRoot, "core");
    const core = coreMetadata.packageJson;
    const honest = readDevModeSapportaPackage(devModePackageRoot, "honest")
      .packageJson;
    const uiMetadata = readDevModeSapportaPackage(devModePackageRoot, "ui");
    const ui = uiMetadata.packageJson;
    const gridMetadata = readDevModeSapportaPackage(
      devModePackageRoot,
      "grid",
    );
    const grid = gridMetadata.packageJson;
    const frontendMetadata = readDevModeSapportaPackage(
      devModePackageRoot,
      "frontend",
    );
    const frontend = frontendMetadata.packageJson;
    const sharedMetadata = readDevModeSapportaPackage(
      devModePackageRoot,
      "shared",
    );
    const shared = sharedMetadata.packageJson;

    const coreInstalled = installedPackageSpecPicker(
      coreMetadata.packageJsonPath,
    );
    const sharedInstalled = installedPackageSpecPicker(
      sharedMetadata.packageJsonPath,
    );
    const frontendInstalled = installedPackageSpecPicker(
      frontendMetadata.packageJsonPath,
    );
    const frontendSpec = declaredPackageSpecPicker(frontend);
    const devIdentityOverrides = Object.fromEntries(
      DEV_MODE_IDENTITY_PACKAGES.map((name) => [
        name,
        exactVersionSpec(
          resolveInstalledPackage(
            name.startsWith("@radix-ui/")
              ? uiMetadata.packageJsonPath
              : name === "@js-temporal/polyfill"
                ? sharedMetadata.packageJsonPath
                : name === "react" ||
                    name === "react-dom" ||
                    name === "react-router-dom" ||
                    name === "zustand"
                  ? frontendMetadata.packageJsonPath
                  : coreMetadata.packageJsonPath,
            name,
          ),
        ),
      ]),
    );

    return {
      core,
      honest,
      ui,
      grid,
      frontend,
      shared,
      specs: {
        core: devMode_sapportaSourcePackageLinkSpec(devModePackageRoot, "core"),
        honest: devMode_sapportaSourcePackageLinkSpec(
          devModePackageRoot,
          "honest",
        ),
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
        betterSqlite3: coreInstalled("better-sqlite3"),
        drizzle: coreInstalled("drizzle-orm"),
        drizzleKit: coreInstalled("drizzle-kit"),
        hono: coreInstalled("hono"),
        honoNodeServer: coreInstalled("@hono/node-server"),
        restCore: coreInstalled("@sapporta/rest-core"),
        temporal: sharedInstalled("@js-temporal/polyfill"),
        zod: coreInstalled("zod"),
        react: frontendInstalled("react"),
        reactDom: frontendInstalled("react-dom"),
        reactRouter: frontendInstalled("react-router-dom"),
        lucideReact: frontendSpec("lucide-react"),
        vite: frontendSpec("vite"),
        viteReact: frontendSpec("@vitejs/plugin-react"),
        tailwindVite: frontendSpec("@tailwindcss/vite"),
        tailwind: frontendSpec("tailwindcss"),
        typesReact: frontendSpec("@types/react"),
        typesReactDom: frontendSpec("@types/react-dom"),
        zustand: frontendInstalled("zustand"),
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
        ...devIdentityOverrides,
        "@hono/node-server": coreInstalled("@hono/node-server"),
      },
    };
  }

  // Published mode runs from installed packages. Here package entrypoints are
  // valid runtime anchors: package managers have materialized the package, and
  // pnpm has already rewritten internal workspace specs during publishing.
  // Using the package-root resolver keeps export-map packages and conventional
  // packages on the same metadata path.
  const coreMetadata = resolveOwningPackage(
    import.meta.url,
    "@sapporta/server",
  );
  const core = coreMetadata.packageJson;
  const honest = readVendoredSapportaPackage(initPaths, "@sapporta/honest");
  const ui = readVendoredSapportaPackage(initPaths, "@sapporta/ui");
  const grid = readVendoredSapportaPackage(initPaths, "@sapporta/grid");
  const frontend = readVendoredSapportaPackage(initPaths, "@sapporta/frontend");
  const shared = readVendoredSapportaPackage(
    initPaths,
    "@sapporta/shared",
  );
  const coreSpec = declaredPackageSpecPicker(core);
  const sharedSpec = declaredPackageSpecPicker(shared);
  const frontendSpec = declaredPackageSpecPicker(frontend);

  // @sapporta packages used by the scaffold are pinned from vendored
  // package.json snapshots instead of dependency specifiers. Source-tree
  // package metadata contains `workspace:*`, while published metadata is
  // rewritten by pnpm; using package versions directly keeps scaffold output
  // independent of where the CLI is running from.
  return {
    core,
    honest,
    ui,
    grid,
    frontend,
    shared,
    specs: {
      core: sapportaPackageSpec(core, "@sapporta/server"),
      honest: sapportaPackageSpec(honest, "@sapporta/honest"),
      ui: sapportaPackageSpec(ui, "@sapporta/ui"),
      grid: sapportaPackageSpec(grid, "@sapporta/grid"),
      frontend: sapportaPackageSpec(frontend, "@sapporta/frontend"),
      shared: sapportaPackageSpec(shared, "@sapporta/shared"),
      betterSqlite3: coreSpec("better-sqlite3"),
      drizzle: coreSpec("drizzle-orm"),
      drizzleKit: coreSpec("drizzle-kit"),
      hono: coreSpec("hono"),
      honoNodeServer: coreSpec("@hono/node-server"),
      restCore: coreSpec("@sapporta/rest-core"),
      temporal: sharedSpec("@js-temporal/polyfill"),
      zod: coreSpec("zod"),
      react: frontendSpec("react"),
      reactDom: frontendSpec("react-dom"),
      reactRouter: frontendSpec("react-router-dom"),
      lucideReact: frontendSpec("lucide-react"),
      vite: frontendSpec("vite"),
      viteReact: frontendSpec("@vitejs/plugin-react"),
      tailwindVite: frontendSpec("@tailwindcss/vite"),
      tailwind: frontendSpec("tailwindcss"),
      typesReact: frontendSpec("@types/react"),
      typesReactDom: frontendSpec("@types/react-dom"),
      zustand: frontendSpec("zustand"),
    },
  };
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readPackageMetadata(packageJsonPath: string): PackageMetadata {
  return {
    packageJsonPath,
    packageJson: readPackageJson(packageJsonPath),
  };
}

function readDevModeSapportaPackage(
  devModePackageRoot: string,
  packageName: Parameters<typeof devMode_sapportaSourcePackageJsonPath>[1],
): PackageMetadata {
  return readPackageMetadata(
    devMode_sapportaSourcePackageJsonPath(devModePackageRoot, packageName),
  );
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

function declaredPackageSpecPicker(pkg: PackageJson): (packageName: string) => string {
  const specs = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  return (packageName) => {
    const spec = specs[packageName];
    if (!spec) {
      throw new Error(
        `${pkg.name ?? "package"}'s package.json is missing "${packageName}" in dependencies/peerDependencies/devDependencies — cannot pin scaffolded dependencies.`,
      );
    }
    return spec;
  };
}

function installedPackageSpecPicker(
  fromPackageJsonPath: string,
): (packageName: string) => string {
  return (packageName) =>
    exactVersionSpec(resolveInstalledPackage(fromPackageJsonPath, packageName));
}

function exactVersionSpec(pkg: PackageMetadata): string {
  const version = pkg.packageJson.version;
  if (!version) {
    throw new Error(
      `${pkg.packageJson.name ?? pkg.packageJsonPath}'s package.json is missing version — cannot pin scaffolded dependencies.`,
    );
  }
  return version;
}

function resolveInstalledPackage(
  fromPackageJsonPath: string,
  packageName: string,
): PackageMetadata {
  const packageRequire = createRequire(fromPackageJsonPath);
  const entrypoint = packageRequire.resolve(packageName);
  const packageJsonPath = findPackageJsonForModule(entrypoint, packageName);
  return readPackageMetadata(packageJsonPath);
}

export function resolveOwningPackage(
  moduleUrl: string,
  packageName: string,
): PackageMetadata {
  // Init needs metadata for the package that owns the currently running file,
  // not its public root export. Resolving "@sapporta/server" through
  // createRequire would use CommonJS export conditions and fail for our
  // ESM-only root export, even though the package owns this module.
  return readPackageMetadata(
    findPackageJsonForModule(fileURLToPath(moduleUrl), packageName),
  );
}

function findPackageJsonForModule(
  modulePath: string,
  packageName: string,
): string {
  // Some dependencies, including Hono, intentionally do not export
  // `./package.json`. Resolve the public entrypoint first, then walk upward to
  // the owning package root. The package-name check is important under pnpm:
  // entrypoints live below nested store paths, and the first package.json found
  // while walking must be the package that owns the resolved module.
  let dir = dirname(modulePath);
  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const pkg = readPackageJson(packageJsonPath);
      if (pkg.name === packageName) {
        return packageJsonPath;
      }
    }
    dir = dirname(dir);
  }
  throw new Error(
    `Could not find package.json for ${packageName} from ${modulePath}.`,
  );
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
  return {
    __SLUG__: project.slug,
    __NAME__: project.name,
    __CORE_SPEC__: packages.specs.core,
    __HONEST_SPEC__: packages.specs.honest,
    __UI_SPEC__: packages.specs.ui,
    __GRID_SPEC__: packages.specs.grid,
    __FRONTEND_SPEC__: packages.specs.frontend,
    __SHARED_SPEC__: packages.specs.shared,
    __HONO_SPEC__: packages.specs.hono,
    __HONO_NODE_SERVER_SPEC__: packages.specs.honoNodeServer,
    __BETTER_SQLITE3_VERSION__: packages.specs.betterSqlite3,
    __DRIZZLE_VERSION__: packages.specs.drizzle,
    __DRIZZLE_KIT_VERSION__: packages.specs.drizzleKit,
    __ZOD_VERSION__: packages.specs.zod,
    __SAPPORTA_REST_CORE_VERSION__: packages.specs.restCore,
    __TEMPORAL_VERSION__: packages.specs.temporal,
    __REACT_VERSION__: packages.specs.react,
    __REACT_DOM_VERSION__: packages.specs.reactDom,
    __REACT_ROUTER_VERSION__: packages.specs.reactRouter,
    __LUCIDE_REACT_VERSION__: packages.specs.lucideReact,
    __VITE_VERSION__: packages.specs.vite,
    __VITE_REACT_VERSION__: packages.specs.viteReact,
    __TAILWIND_VITE_VERSION__: packages.specs.tailwindVite,
    __TAILWIND_VERSION__: packages.specs.tailwind,
    __TYPES_REACT_VERSION__: packages.specs.typesReact,
    __TYPES_REACT_DOM_VERSION__: packages.specs.typesReactDom,
    __ZUSTAND_VERSION__: packages.specs.zustand,
  };
}

function createScaffoldDirectories(project: ScaffoldProject): void {
  mkdirSync(project.apiDir, { recursive: true });
  mkdirSync(join(project.apiDir, "app"), { recursive: true });
  mkdirSync(join(project.apiDir, "schema"), { recursive: true });
  mkdirSync(join(project.apiDir, "migrations"), { recursive: true });
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

function installWorkspace(
  projectRoot: string,
  progress: ProgressLogger,
): void {
  // pnpm presence was verified at the top of this function, so this is
  // guaranteed to resolve. One pass installs the root workspace.
  progress("Installing workspace dependencies with pnpm install...");
  execSync("pnpm install", { cwd: projectRoot, stdio: "inherit" });
}
