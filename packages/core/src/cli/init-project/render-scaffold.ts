import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fromProjectRoot } from "../../project-paths.js";
import {
  devMode_sapportaSourcePackageJsonPath,
  devMode_sapportaSourcePackageLinkSpec,
  initProjectPackagePaths,
} from "./paths.js";
import { SCAFFOLD_FILES, type ScaffoldFile } from "./scaffold-files.js";

export type PackageJson = {
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

export type ScaffoldProject = {
  root: string;
  name: string;
  slug: string;
  packageJsonPath: string;
  apiDir: string;
  frontendDir: string;
  sharedDir: string;
};

export type ScaffoldPackages = {
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
    caslAbility: string;
    betterSqlite3: string;
    drizzle: string;
    drizzleKit: string;
    hono: string;
    honoNodeServer: string;
    nodemailer: string;
    typesNodemailer: string;
    restCore: string;
    temporal: string;
    zod: string;
    betterAuth: string;
    betterAuthCli: string;
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

export type RenderedScaffoldFile = ScaffoldFile & {
  content: string;
};

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

export function scaffoldProjectFromOptions(opts: {
  dir: string;
  name?: string;
}): ScaffoldProject {
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

export function renderScaffoldFiles(
  project: ScaffoldProject,
  devModePackageRoot: string | undefined,
): RenderedScaffoldFile[] {
  const initPaths = initProjectPackagePaths();
  const packages = resolveScaffoldPackages(initPaths, devModePackageRoot);
  const replacements = buildTemplateReplacements(project, packages);
  return buildScaffoldFiles(initPaths, replacements, packages.pnpmOverrides);
}

export function resolveScaffoldPackages(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  devModePackageRoot: string | undefined,
): ScaffoldPackages {
  if (devModePackageRoot) {
    const coreMetadata = readDevModeSapportaPackage(devModePackageRoot, "core");
    const core = coreMetadata.packageJson;
    const honest = readDevModeSapportaPackage(
      devModePackageRoot,
      "honest",
    ).packageJson;
    const uiMetadata = readDevModeSapportaPackage(devModePackageRoot, "ui");
    const ui = uiMetadata.packageJson;
    const gridMetadata = readDevModeSapportaPackage(devModePackageRoot, "grid");
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
    const coreSpec = declaredPackageSpecPicker(core);
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
        caslAbility: coreInstalled("@casl/ability"),
        betterSqlite3: coreInstalled("better-sqlite3"),
        drizzle: coreInstalled("drizzle-orm"),
        drizzleKit: coreInstalled("drizzle-kit"),
        hono: coreInstalled("hono"),
        honoNodeServer: coreInstalled("@hono/node-server"),
        nodemailer: coreInstalled("nodemailer"),
        typesNodemailer: coreSpec("@types/nodemailer"),
        restCore: coreInstalled("@sapporta/rest-core"),
        temporal: sharedInstalled("@js-temporal/polyfill"),
        zod: coreInstalled("zod"),
        betterAuth: coreInstalled("better-auth"),
        betterAuthCli: coreInstalled("auth"),
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

  const coreMetadata = resolveOwningPackage(
    import.meta.url,
    "@sapporta/server",
  );
  const core = coreMetadata.packageJson;
  const honest = readVendoredSapportaPackage(initPaths, "@sapporta/honest");
  const ui = readVendoredSapportaPackage(initPaths, "@sapporta/ui");
  const grid = readVendoredSapportaPackage(initPaths, "@sapporta/grid");
  const frontend = readVendoredSapportaPackage(initPaths, "@sapporta/frontend");
  const shared = readVendoredSapportaPackage(initPaths, "@sapporta/shared");
  const coreSpec = declaredPackageSpecPicker(core);
  const sharedSpec = declaredPackageSpecPicker(shared);
  const frontendSpec = declaredPackageSpecPicker(frontend);

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
      caslAbility: coreSpec("@casl/ability"),
      betterSqlite3: coreSpec("better-sqlite3"),
      drizzle: coreSpec("drizzle-orm"),
      drizzleKit: coreSpec("drizzle-kit"),
      hono: coreSpec("hono"),
      honoNodeServer: coreSpec("@hono/node-server"),
      nodemailer: coreSpec("nodemailer"),
      typesNodemailer: coreSpec("@types/nodemailer"),
      restCore: coreSpec("@sapporta/rest-core"),
      temporal: sharedSpec("@js-temporal/polyfill"),
      zod: coreSpec("zod"),
      betterAuth: coreSpec("better-auth"),
      betterAuthCli: coreSpec("auth"),
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

export function resolveOwningPackage(
  moduleUrl: string,
  packageName: string,
): PackageMetadata {
  return readPackageMetadata(
    findPackageJsonForModule(fileURLToPath(moduleUrl), packageName),
  );
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
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
      `${packageName}'s package.json is missing version - cannot pin scaffolded dependencies.`,
    );
  }
  return `^${pkg.version}`;
}

function declaredPackageSpecPicker(
  pkg: PackageJson,
): (packageName: string) => string {
  const specs = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  return (packageName) => {
    const spec = specs[packageName];
    if (!spec) {
      throw new Error(
        `${pkg.name ?? "package"}'s package.json is missing "${packageName}" in dependencies/peerDependencies/devDependencies - cannot pin scaffolded dependencies.`,
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
      `${pkg.packageJson.name ?? pkg.packageJsonPath}'s package.json is missing version - cannot pin scaffolded dependencies.`,
    );
  }
  return version;
}

function resolveInstalledPackage(
  fromPackageJsonPath: string,
  packageName: string,
): PackageMetadata {
  const packageRequire = createRequire(fromPackageJsonPath);
  const entrypoint = resolveInstalledPackageEntrypoint(
    packageRequire,
    packageName,
  );
  const packageJsonPath = findPackageJsonForModule(entrypoint, packageName);
  return readPackageMetadata(packageJsonPath);
}

function resolveInstalledPackageEntrypoint(
  packageRequire: NodeJS.Require,
  packageName: string,
): string {
  try {
    return packageRequire.resolve(packageName);
  } catch (error) {
    if (
      isNodeError(error) &&
      error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" &&
      packageName === "auth"
    ) {
      return packageRequire.resolve("auth/api");
    }
    throw error;
  }
}

function findPackageJsonForModule(
  modulePath: string,
  packageName: string,
): string {
  let dir = dirname(modulePath);
  while (dir !== dirname(dir)) {
    const packageJsonPath = `${dir}/package.json`;
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
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
    "%%SAPPORTA:SLUG%%": project.slug,
    "%%SAPPORTA:NAME%%": project.name,
    "%%SAPPORTA:BETTER_AUTH_DEV_SECRET%%":
      randomBytes(32).toString("base64url"),
    "%%SAPPORTA:CORE_SPEC%%": packages.specs.core,
    "%%SAPPORTA:HONEST_SPEC%%": packages.specs.honest,
    "%%SAPPORTA:UI_SPEC%%": packages.specs.ui,
    "%%SAPPORTA:GRID_SPEC%%": packages.specs.grid,
    "%%SAPPORTA:FRONTEND_SPEC%%": packages.specs.frontend,
    "%%SAPPORTA:SHARED_SPEC%%": packages.specs.shared,
    "%%SAPPORTA:CASL_ABILITY_VERSION%%": packages.specs.caslAbility,
    "%%SAPPORTA:HONO_SPEC%%": packages.specs.hono,
    "%%SAPPORTA:HONO_NODE_SERVER_SPEC%%": packages.specs.honoNodeServer,
    "%%SAPPORTA:NODEMAILER_VERSION%%": packages.specs.nodemailer,
    "%%SAPPORTA:TYPES_NODEMAILER_VERSION%%": packages.specs.typesNodemailer,
    "%%SAPPORTA:BETTER_SQLITE3_VERSION%%": packages.specs.betterSqlite3,
    "%%SAPPORTA:DRIZZLE_VERSION%%": packages.specs.drizzle,
    "%%SAPPORTA:DRIZZLE_KIT_VERSION%%": packages.specs.drizzleKit,
    "%%SAPPORTA:ZOD_VERSION%%": packages.specs.zod,
    "%%SAPPORTA:BETTER_AUTH_VERSION%%": packages.specs.betterAuth,
    "%%SAPPORTA:SAPPORTA_REST_CORE_VERSION%%": packages.specs.restCore,
    "%%SAPPORTA:TEMPORAL_VERSION%%": packages.specs.temporal,
    "%%SAPPORTA:REACT_VERSION%%": packages.specs.react,
    "%%SAPPORTA:REACT_DOM_VERSION%%": packages.specs.reactDom,
    "%%SAPPORTA:REACT_ROUTER_VERSION%%": packages.specs.reactRouter,
    "%%SAPPORTA:LUCIDE_REACT_VERSION%%": packages.specs.lucideReact,
    "%%SAPPORTA:VITE_VERSION%%": packages.specs.vite,
    "%%SAPPORTA:VITE_REACT_VERSION%%": packages.specs.viteReact,
    "%%SAPPORTA:TAILWIND_VITE_VERSION%%": packages.specs.tailwindVite,
    "%%SAPPORTA:TAILWIND_VERSION%%": packages.specs.tailwind,
    "%%SAPPORTA:TYPES_REACT_VERSION%%": packages.specs.typesReact,
    "%%SAPPORTA:TYPES_REACT_DOM_VERSION%%": packages.specs.typesReactDom,
    "%%SAPPORTA:ZUSTAND_VERSION%%": packages.specs.zustand,
  };
}

function buildScaffoldFiles(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  replacements: Record<string, string>,
  pnpmOverrides: Record<string, string> | undefined,
): RenderedScaffoldFile[] {
  return SCAFFOLD_FILES.map((file) => {
    let content = renderTemplate(initPaths, file.src, replacements);
    if (file.dest === "package.json" && pnpmOverrides) {
      content = addPnpmOverrides(content, pnpmOverrides);
    }
    return { ...file, content };
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
  const pkg = JSON.parse(rootPackageJson) as PackageJson & {
    pnpm?: { overrides?: Record<string, string> };
  };
  pkg.pnpm = pkg.pnpm ?? {};
  pkg.pnpm.overrides = { ...(pkg.pnpm.overrides ?? {}), ...pnpmOverrides };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}
