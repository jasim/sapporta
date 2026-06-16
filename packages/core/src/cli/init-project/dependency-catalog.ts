import {
  declaredPackageSpec,
  exactVersionSpec,
  readDevModeSapportaPackage,
  readPackageJson,
  resolveInstalledPackage,
  resolveOwningPackage,
  sapportaPackageSpec,
  type PackageJson,
  type PackageMetadata,
} from "./package-metadata.js";
import {
  devMode_sapportaSourcePackageLinkSpec,
  initProjectPackagePaths,
} from "./paths.js";

export type DependencyKey =
  | "core"
  | "honest"
  | "ui"
  | "grid"
  | "frontend"
  | "shared"
  | "caslAbility"
  | "betterSqlite3"
  | "drizzle"
  | "drizzleKit"
  | "hono"
  | "honoNodeServer"
  | "nodemailer"
  | "typesNodemailer"
  | "restCore"
  | "temporal"
  | "zod"
  | "betterAuth"
  | "betterAuthCli"
  | "react"
  | "reactDom"
  | "reactRouter"
  | "lucideReact"
  | "vite"
  | "viteReact"
  | "tailwindVite"
  | "tailwind"
  | "typesReact"
  | "typesReactDom"
  | "zustand";

export type TemplateToken = `%%SAPPORTA:${string}%%`;
export type PackageName = string;
export type SapportaPackageName = `@sapporta/${string}`;
type SapportaSourcePackage =
  | "core"
  | "frontend"
  | "grid"
  | "honest"
  | "shared"
  | "ui";
type DeclaredPackageSource = "core" | "frontend" | "shared";

type ProdSpecSource =
  | { kind: "sapporta"; sourcePackage: SapportaSourcePackage }
  | { kind: "declared"; sourcePackage: DeclaredPackageSource };

type DevSpecSource =
  | { kind: "sapporta-link"; sourcePackage: SapportaSourcePackage }
  | { kind: "declared"; sourcePackage: DeclaredPackageSource }
  | { kind: "installed"; sourcePackage: DeclaredPackageSource };

export type DependencyDefinition = {
  key: DependencyKey;
  packageName: PackageName;
  token?: TemplateToken;
  prodSpec: ProdSpecSource;
  devSpec: DevSpecSource;
};

export type DependencyCatalog = {
  definitions: readonly DependencyDefinition[];
  tokenByKey: ReadonlyMap<DependencyKey, TemplateToken>;
};

export type ScaffoldPackages = {
  core: PackageJson;
  honest: PackageJson;
  ui: PackageJson;
  grid: PackageJson;
  frontend: PackageJson;
  shared: PackageJson;
  specs: Record<DependencyKey, string>;
  pnpmOverrides?: Record<string, string>;
};

export type PnpmOverrides = Record<string, string>;

export type ProdPackageMetadata = {
  core: PackageMetadata;
  honest: PackageJson;
  ui: PackageJson;
  grid: PackageJson;
  frontend: PackageJson;
  shared: PackageJson;
};

export type DevPackageMetadata = {
  core: PackageMetadata;
  honest: PackageMetadata;
  ui: PackageMetadata;
  grid: PackageMetadata;
  frontend: PackageMetadata;
  shared: PackageMetadata;
};

export const DEPENDENCY_DEFINITIONS = [
  sapportaDependency(
    "core",
    "core",
    "@sapporta/server",
    "%%SAPPORTA:CORE_SPEC%%",
  ),
  sapportaDependency(
    "honest",
    "honest",
    "@sapporta/honest",
    "%%SAPPORTA:HONEST_SPEC%%",
  ),
  sapportaDependency("ui", "ui", "@sapporta/ui", "%%SAPPORTA:UI_SPEC%%"),
  sapportaDependency(
    "grid",
    "grid",
    "@sapporta/grid",
    "%%SAPPORTA:GRID_SPEC%%",
  ),
  sapportaDependency(
    "frontend",
    "frontend",
    "@sapporta/frontend",
    "%%SAPPORTA:FRONTEND_SPEC%%",
  ),
  sapportaDependency(
    "shared",
    "shared",
    "@sapporta/shared",
    "%%SAPPORTA:SHARED_SPEC%%",
  ),
  coreInstalledDependency(
    "caslAbility",
    "@casl/ability",
    "%%SAPPORTA:CASL_ABILITY_VERSION%%",
  ),
  coreInstalledDependency(
    "betterSqlite3",
    "better-sqlite3",
    "%%SAPPORTA:BETTER_SQLITE3_VERSION%%",
  ),
  coreInstalledDependency(
    "drizzle",
    "drizzle-orm",
    "%%SAPPORTA:DRIZZLE_VERSION%%",
  ),
  coreInstalledDependency(
    "drizzleKit",
    "drizzle-kit",
    "%%SAPPORTA:DRIZZLE_KIT_VERSION%%",
  ),
  coreInstalledDependency("hono", "hono", "%%SAPPORTA:HONO_SPEC%%"),
  coreInstalledDependency(
    "honoNodeServer",
    "@hono/node-server",
    "%%SAPPORTA:HONO_NODE_SERVER_SPEC%%",
  ),
  coreInstalledDependency(
    "nodemailer",
    "nodemailer",
    "%%SAPPORTA:NODEMAILER_VERSION%%",
  ),
  coreDeclaredDependency(
    "typesNodemailer",
    "@types/nodemailer",
    "%%SAPPORTA:TYPES_NODEMAILER_VERSION%%",
  ),
  coreInstalledDependency(
    "restCore",
    "@sapporta/rest-core",
    "%%SAPPORTA:SAPPORTA_REST_CORE_VERSION%%",
  ),
  dependency(
    "temporal",
    "@js-temporal/polyfill",
    "%%SAPPORTA:TEMPORAL_VERSION%%",
    { kind: "declared", sourcePackage: "shared" },
    { kind: "installed", sourcePackage: "shared" },
  ),
  coreInstalledDependency("zod", "zod", "%%SAPPORTA:ZOD_VERSION%%"),
  coreInstalledDependency(
    "betterAuth",
    "better-auth",
    "%%SAPPORTA:BETTER_AUTH_VERSION%%",
  ),
  coreInstalledDependency("betterAuthCli", "auth"),
  frontendInstalledDependency("react", "react", "%%SAPPORTA:REACT_VERSION%%"),
  frontendInstalledDependency(
    "reactDom",
    "react-dom",
    "%%SAPPORTA:REACT_DOM_VERSION%%",
  ),
  frontendInstalledDependency(
    "reactRouter",
    "react-router-dom",
    "%%SAPPORTA:REACT_ROUTER_VERSION%%",
  ),
  frontendDeclaredDependency(
    "lucideReact",
    "lucide-react",
    "%%SAPPORTA:LUCIDE_REACT_VERSION%%",
  ),
  frontendDeclaredDependency("vite", "vite", "%%SAPPORTA:VITE_VERSION%%"),
  frontendDeclaredDependency(
    "viteReact",
    "@vitejs/plugin-react",
    "%%SAPPORTA:VITE_REACT_VERSION%%",
  ),
  frontendDeclaredDependency(
    "tailwindVite",
    "@tailwindcss/vite",
    "%%SAPPORTA:TAILWIND_VITE_VERSION%%",
  ),
  frontendDeclaredDependency(
    "tailwind",
    "tailwindcss",
    "%%SAPPORTA:TAILWIND_VERSION%%",
  ),
  frontendDeclaredDependency(
    "typesReact",
    "@types/react",
    "%%SAPPORTA:TYPES_REACT_VERSION%%",
  ),
  frontendDeclaredDependency(
    "typesReactDom",
    "@types/react-dom",
    "%%SAPPORTA:TYPES_REACT_DOM_VERSION%%",
  ),
  frontendInstalledDependency(
    "zustand",
    "zustand",
    "%%SAPPORTA:ZUSTAND_VERSION%%",
  ),
] as const satisfies readonly DependencyDefinition[];

export const DEPENDENCY_CATALOG: DependencyCatalog = {
  definitions: DEPENDENCY_DEFINITIONS,
  tokenByKey: tokensForCatalog(DEPENDENCY_DEFINITIONS),
};

export const DEV_MODE_IDENTITY_PACKAGES = [
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

export function tokensForCatalog(
  definitions: readonly DependencyDefinition[] = DEPENDENCY_DEFINITIONS,
): ReadonlyMap<DependencyKey, TemplateToken> {
  return new Map(
    definitions.flatMap((definition) =>
      definition.token ? [[definition.key, definition.token]] : [],
    ),
  );
}

export function resolveProdSpecsFromMetadata(
  metadata: ProdPackageMetadata,
): ScaffoldPackages {
  const core = metadata.core.packageJson;

  return {
    core,
    honest: metadata.honest,
    ui: metadata.ui,
    grid: metadata.grid,
    frontend: metadata.frontend,
    shared: metadata.shared,
    specs: specsFromDefinitions((definition) =>
      resolveProdSpec(definition, metadata),
    ),
  };
}

export function resolveDevSpecsFromMetadata(opts: {
  devModePackageRoot: string;
  metadata: DevPackageMetadata;
  installedSpec: (fromPackageJsonPath: string, packageName: string) => string;
}): ScaffoldPackages {
  const { metadata } = opts;
  return {
    core: metadata.core.packageJson,
    honest: metadata.honest.packageJson,
    ui: metadata.ui.packageJson,
    grid: metadata.grid.packageJson,
    frontend: metadata.frontend.packageJson,
    shared: metadata.shared.packageJson,
    specs: specsFromDefinitions((definition) =>
      resolveDevSpec(definition, opts),
    ),
    pnpmOverrides: buildPnpmOverrides({
      devModePackageRoot: opts.devModePackageRoot,
      corePackageJsonPath: metadata.core.packageJsonPath,
      uiPackageJsonPath: metadata.ui.packageJsonPath,
      sharedPackageJsonPath: metadata.shared.packageJsonPath,
      frontendPackageJsonPath: metadata.frontend.packageJsonPath,
      installedSpec: opts.installedSpec,
    }),
  };
}

export function resolveScaffoldPackages(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  devModePackageRoot: string | undefined,
): ScaffoldPackages {
  if (devModePackageRoot) {
    return resolveDevSpecsFromMetadata({
      devModePackageRoot,
      metadata: {
        core: readDevModeSapportaPackage(devModePackageRoot, "core"),
        honest: readDevModeSapportaPackage(devModePackageRoot, "honest"),
        ui: readDevModeSapportaPackage(devModePackageRoot, "ui"),
        grid: readDevModeSapportaPackage(devModePackageRoot, "grid"),
        frontend: readDevModeSapportaPackage(devModePackageRoot, "frontend"),
        shared: readDevModeSapportaPackage(devModePackageRoot, "shared"),
      },
      installedSpec: (fromPackageJsonPath, packageName) =>
        exactInstalledVersionSpec(
          resolveInstalledPackage(fromPackageJsonPath, packageName),
        ),
    });
  }

  return resolveProdSpecsFromMetadata({
    core: resolveOwningPackage(import.meta.url, "@sapporta/server"),
    honest: readVendoredSapportaPackage(initPaths, "@sapporta/honest"),
    ui: readVendoredSapportaPackage(initPaths, "@sapporta/ui"),
    grid: readVendoredSapportaPackage(initPaths, "@sapporta/grid"),
    frontend: readVendoredSapportaPackage(initPaths, "@sapporta/frontend"),
    shared: readVendoredSapportaPackage(initPaths, "@sapporta/shared"),
  });
}

export function buildPnpmOverrides(opts: {
  devModePackageRoot: string;
  corePackageJsonPath: string;
  uiPackageJsonPath: string;
  sharedPackageJsonPath: string;
  frontendPackageJsonPath: string;
  installedSpec: (fromPackageJsonPath: string, packageName: string) => string;
}): PnpmOverrides {
  const packagePathFor = (packageName: string): string => {
    if (packageName.startsWith("@radix-ui/")) return opts.uiPackageJsonPath;
    if (packageName === "@js-temporal/polyfill")
      return opts.sharedPackageJsonPath;
    if (
      packageName === "react" ||
      packageName === "react-dom" ||
      packageName === "react-router-dom" ||
      packageName === "zustand"
    ) {
      return opts.frontendPackageJsonPath;
    }
    return opts.corePackageJsonPath;
  };

  const devIdentityOverrides: Record<string, string> = {};
  for (const name of DEV_MODE_IDENTITY_PACKAGES) {
    devIdentityOverrides[name] = opts.installedSpec(packagePathFor(name), name);
  }

  return {
    "@sapporta/honest": devMode_sapportaSourcePackageLinkSpec(
      opts.devModePackageRoot,
      "honest",
    ),
    "@sapporta/shared": devMode_sapportaSourcePackageLinkSpec(
      opts.devModePackageRoot,
      "shared",
    ),
    "@sapporta/ui": devMode_sapportaSourcePackageLinkSpec(
      opts.devModePackageRoot,
      "ui",
    ),
    "@sapporta/grid": devMode_sapportaSourcePackageLinkSpec(
      opts.devModePackageRoot,
      "grid",
    ),
    ...devIdentityOverrides,
    "@hono/node-server": opts.installedSpec(
      opts.corePackageJsonPath,
      "@hono/node-server",
    ),
  };
}

export function exactInstalledVersionSpec(pkg: PackageMetadata): string {
  return exactVersionSpec(pkg);
}

function readVendoredSapportaPackage(
  initPaths: ReturnType<typeof initProjectPackagePaths>,
  packageName: `@sapporta/${string}`,
): PackageJson {
  const shortName = packageName.slice("@sapporta/".length);
  return readPackageJson(initPaths.vendoredPackageJsonPath(shortName));
}

function specsFromDefinitions(
  resolve: (definition: DependencyDefinition) => string,
): Record<DependencyKey, string> {
  const specs = {} as Record<DependencyKey, string>;
  for (const definition of DEPENDENCY_DEFINITIONS) {
    specs[definition.key] = resolve(definition);
  }
  return specs;
}

function resolveProdSpec(
  definition: DependencyDefinition,
  metadata: ProdPackageMetadata,
): string {
  switch (definition.prodSpec.kind) {
    case "sapporta":
      return sapportaPackageSpec(
        prodPackageJson(metadata, definition.prodSpec.sourcePackage),
        asSapportaPackageName(definition.packageName),
      );
    case "declared":
      return declaredPackageSpec(
        prodPackageJson(metadata, definition.prodSpec.sourcePackage),
        definition.packageName,
      );
  }
}

function resolveDevSpec(
  definition: DependencyDefinition,
  opts: {
    devModePackageRoot: string;
    metadata: DevPackageMetadata;
    installedSpec: (fromPackageJsonPath: string, packageName: string) => string;
  },
): string {
  switch (definition.devSpec.kind) {
    case "sapporta-link":
      return devMode_sapportaSourcePackageLinkSpec(
        opts.devModePackageRoot,
        definition.devSpec.sourcePackage,
      );
    case "declared":
      return declaredPackageSpec(
        opts.metadata[definition.devSpec.sourcePackage].packageJson,
        definition.packageName,
      );
    case "installed":
      return opts.installedSpec(
        opts.metadata[definition.devSpec.sourcePackage].packageJsonPath,
        definition.packageName,
      );
  }
}

function prodPackageJson(
  metadata: ProdPackageMetadata,
  sourcePackage: SapportaSourcePackage,
): PackageJson {
  switch (sourcePackage) {
    case "core":
      return metadata.core.packageJson;
    case "frontend":
      return metadata.frontend;
    case "grid":
      return metadata.grid;
    case "honest":
      return metadata.honest;
    case "shared":
      return metadata.shared;
    case "ui":
      return metadata.ui;
  }
}

function asSapportaPackageName(packageName: PackageName): SapportaPackageName {
  if (!packageName.startsWith("@sapporta/")) {
    throw new Error(`Expected a Sapporta package name, got ${packageName}.`);
  }
  return packageName as SapportaPackageName;
}

function sapportaDependency(
  key: DependencyKey,
  sourcePackage: SapportaSourcePackage,
  packageName: SapportaPackageName,
  token: TemplateToken,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "sapporta", sourcePackage },
    { kind: "sapporta-link", sourcePackage },
  );
}

function coreInstalledDependency(
  key: DependencyKey,
  packageName: PackageName,
  token?: TemplateToken,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "core" },
    { kind: "installed", sourcePackage: "core" },
  );
}

function coreDeclaredDependency(
  key: DependencyKey,
  packageName: PackageName,
  token?: TemplateToken,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "core" },
    { kind: "declared", sourcePackage: "core" },
  );
}

function frontendInstalledDependency(
  key: DependencyKey,
  packageName: PackageName,
  token?: TemplateToken,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "frontend" },
    { kind: "installed", sourcePackage: "frontend" },
  );
}

function frontendDeclaredDependency(
  key: DependencyKey,
  packageName: PackageName,
  token?: TemplateToken,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "frontend" },
    { kind: "declared", sourcePackage: "frontend" },
  );
}

function dependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  prodSpec: ProdSpecSource,
  devSpec: DevSpecSource,
): DependencyDefinition {
  return { key, packageName, token, prodSpec, devSpec };
}
