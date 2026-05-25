import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    hono: string;
    honoNodeServer: string;
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
    const core = coreMetadata.packageJson as PackageJson & {
      dependencies: Record<string, string>;
    };
    const ui = readDevModeSapportaPackage(devModePackageRoot, "ui").packageJson;
    const grid = readDevModeSapportaPackage(
      devModePackageRoot,
      "grid",
    ).packageJson;
    const frontend = readDevModeSapportaPackage(
      devModePackageRoot,
      "frontend",
    ).packageJson;
    const shared = readDevModeSapportaPackage(devModePackageRoot, "shared")
      .packageJson as PackageJson & {
      dependencies: Record<string, string>;
    };

    // The API template imports Hono directly while @sapporta/server also
    // exposes functions typed in terms of Hono. In dev mode both sides must
    // resolve to the same installed package version, otherwise TypeScript sees
    // two incompatible Hono class/type identities. Resolve from
    // @sapporta/server's package context and use exact overrides so pnpm cannot
    // float the generated app to a second Hono installation.
    const hono = resolveInstalledPackage(coreMetadata.packageJsonPath, "hono");
    const honoNodeServer = resolveInstalledPackage(
      coreMetadata.packageJsonPath,
      "@hono/node-server",
    );

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
        hono: exactVersionSpec(hono),
        honoNodeServer: exactVersionSpec(honoNodeServer),
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
        hono: exactVersionSpec(hono),
        "@hono/node-server": exactVersionSpec(honoNodeServer),
      },
    };
  }

  // Published mode runs from installed packages. Here package entrypoints are
  // valid runtime anchors: package managers have materialized the package, and
  // pnpm has already rewritten internal workspace specs during publishing.
  // Using the package-root resolver keeps export-map packages and conventional
  // packages on the same metadata path.
  const coreMetadata = resolveInstalledPackage(
    import.meta.url,
    "@sapporta/server",
  );
  const core = coreMetadata.packageJson as PackageJson & {
    dependencies: Record<string, string>;
  };
  const ui = readVendoredSapportaPackage(initPaths, "@sapporta/ui");
  const grid = readVendoredSapportaPackage(initPaths, "@sapporta/grid");
  const frontend = readVendoredSapportaPackage(initPaths, "@sapporta/frontend");
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
      hono: requiredDependencySpec(core, "hono"),
      honoNodeServer: requiredDependencySpec(core, "@hono/node-server"),
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

function requiredDependencySpec(
  pkg: PackageJson,
  dependencyName: string,
): string {
  const spec = pkg.dependencies?.[dependencyName];
  if (!spec) {
    throw new Error(
      `${pkg.name ?? "package"}'s package.json is missing "${dependencyName}" in dependencies — cannot pin scaffolded dependencies.`,
    );
  }
  return spec;
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
    __HONO_SPEC__: packages.specs.hono,
    __HONO_NODE_SERVER_SPEC__: packages.specs.honoNodeServer,
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
