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
  | "typesBetterSqlite3"
  | "drizzle"
  | "drizzleKit"
  | "kysely"
  | "hono"
  | "honoNodeServer"
  | "nodemailer"
  | "typesNodemailer"
  | "restCore"
  | "tanstackReactForm"
  | "tanstackReactQuery"
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
  "core" | "frontend" | "grid" | "honest" | "shared" | "ui";
type DeclaredPackageSource = "core" | "frontend" | "shared";

type ProdSpecSource =
  | { kind: "sapporta"; sourcePackage: SapportaSourcePackage }
  | { kind: "declared"; sourcePackage: DeclaredPackageSource };

type DevSpecSource =
  | { kind: "sapporta-link"; sourcePackage: SapportaSourcePackage }
  | { kind: "declared"; sourcePackage: DeclaredPackageSource }
  | { kind: "installed"; sourcePackage: DeclaredPackageSource };

/**
 * A source-linked generated project has two dependency roots: its own
 * node_modules and the linked Sapporta checkout's node_modules. Following the
 * links normally can load two physical copies of React, Hono, Zod, or another
 * dependency that application code and Sapporta code use in the same runtime.
 * Equal versions do not make those copies the same JavaScript module instance.
 *
 * `sharedRuntime` records the single source-link rule at the catalog entry that
 * already owns the dependency's name and development version: when both sides
 * can import a dependency in a scope, the generated project supplies that
 * scope's runtime instance. Both booleans stay explicit so adding a dependency
 * requires a deliberate browser and server decision. This is development
 * resolution metadata, not a general claim about nominal package identity.
 * Registry scaffolds ignore it and use ordinary peer dependency resolution.
 */
export type RuntimeScope = "browser" | "server";

export type SharedRuntimeScopes = Readonly<{
  browser: boolean;
  server: boolean;
}>;

export type DependencyDefinition = {
  key: DependencyKey;
  packageName: PackageName;
  token?: TemplateToken;
  prodSpec: ProdSpecSource;
  devSpec: DevSpecSource;
  sharedRuntime: SharedRuntimeScopes;
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
  /** Enables the one resolver path used by every live `link:` scaffold. */
  sourceLinkMode: boolean;
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
    { browser: false, server: false },
  ),
  sapportaDependency(
    "honest",
    "honest",
    "@sapporta/honest",
    "%%SAPPORTA:HONEST_SPEC%%",
    { browser: false, server: false },
  ),
  sapportaDependency("ui", "ui", "@sapporta/ui", "%%SAPPORTA:UI_SPEC%%", {
    browser: false,
    server: false,
  }),
  sapportaDependency(
    "grid",
    "grid",
    "@sapporta/grid",
    "%%SAPPORTA:GRID_SPEC%%",
    { browser: false, server: false },
  ),
  sapportaDependency(
    "frontend",
    "frontend",
    "@sapporta/frontend",
    "%%SAPPORTA:FRONTEND_SPEC%%",
    { browser: false, server: false },
  ),
  sapportaDependency(
    "shared",
    "shared",
    "@sapporta/shared",
    "%%SAPPORTA:SHARED_SPEC%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency(
    "caslAbility",
    "@casl/ability",
    "%%SAPPORTA:CASL_ABILITY_VERSION%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency(
    "betterSqlite3",
    "better-sqlite3",
    "%%SAPPORTA:BETTER_SQLITE3_VERSION%%",
    { browser: false, server: true },
  ),
  coreInstalledDependency(
    "drizzle",
    "drizzle-orm",
    "%%SAPPORTA:DRIZZLE_VERSION%%",
    { browser: false, server: true },
  ),
  // These two never run as shared code, but they are optional peers of
  // drizzle-orm and therefore part of pnpm's peer-set resolution for it. If
  // the generated project resolves either to a different version than the
  // linked checkout, pnpm materializes a second drizzle-orm instance and
  // TypeScript sees two incompatible declarations of every drizzle type.
  coreInstalledDependency(
    "typesBetterSqlite3",
    "@types/better-sqlite3",
    undefined,
    { browser: false, server: true },
  ),
  coreInstalledDependency("kysely", "kysely", undefined, {
    browser: false,
    server: true,
  }),
  coreInstalledDependency(
    "drizzleKit",
    "drizzle-kit",
    "%%SAPPORTA:DRIZZLE_KIT_VERSION%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency("hono", "hono", "%%SAPPORTA:HONO_SPEC%%", {
    browser: false,
    server: true,
  }),
  coreInstalledDependency(
    "honoNodeServer",
    "@hono/node-server",
    "%%SAPPORTA:HONO_NODE_SERVER_SPEC%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency(
    "nodemailer",
    "nodemailer",
    "%%SAPPORTA:NODEMAILER_VERSION%%",
    { browser: false, server: false },
  ),
  coreDeclaredDependency(
    "typesNodemailer",
    "@types/nodemailer",
    "%%SAPPORTA:TYPES_NODEMAILER_VERSION%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency(
    "restCore",
    "@sapporta/rest-core",
    "%%SAPPORTA:SAPPORTA_REST_CORE_VERSION%%",
    { browser: true, server: true },
  ),
  frontendInstalledDependency(
    "tanstackReactForm",
    "@tanstack/react-form",
    "%%SAPPORTA:TANSTACK_REACT_FORM_VERSION%%",
    { browser: true, server: false },
  ),
  frontendInstalledDependency(
    "tanstackReactQuery",
    "@tanstack/react-query",
    "%%SAPPORTA:TANSTACK_REACT_QUERY_VERSION%%",
    { browser: true, server: false },
  ),
  dependency(
    "temporal",
    "@js-temporal/polyfill",
    "%%SAPPORTA:TEMPORAL_VERSION%%",
    { kind: "declared", sourcePackage: "shared" },
    { kind: "installed", sourcePackage: "shared" },
    { browser: true, server: true },
  ),
  coreInstalledDependency("zod", "zod", "%%SAPPORTA:ZOD_VERSION%%", {
    browser: true,
    server: true,
  }),
  // A generated project's auth tables come from `project-auth/schema.ts`,
  // generated for one Better Auth version, and Better Auth adds columns in
  // minor releases. @sapporta/server therefore declares better-auth as a tilde
  // range, which holds a generated project to the minor line that schema
  // covers. Changing the minor means regenerating the schema with it.
  coreInstalledDependency(
    "betterAuth",
    "better-auth",
    "%%SAPPORTA:BETTER_AUTH_VERSION%%",
    { browser: false, server: false },
  ),
  coreInstalledDependency("betterAuthCli", "auth", undefined, {
    browser: false,
    server: false,
  }),
  frontendInstalledDependency("react", "react", "%%SAPPORTA:REACT_VERSION%%", {
    browser: true,
    server: false,
  }),
  frontendInstalledDependency(
    "reactDom",
    "react-dom",
    "%%SAPPORTA:REACT_DOM_VERSION%%",
    { browser: true, server: false },
  ),
  frontendInstalledDependency(
    "reactRouter",
    "react-router-dom",
    "%%SAPPORTA:REACT_ROUTER_VERSION%%",
    { browser: true, server: false },
  ),
  frontendDeclaredDependency(
    "lucideReact",
    "lucide-react",
    "%%SAPPORTA:LUCIDE_REACT_VERSION%%",
    { browser: false, server: false },
  ),
  frontendDeclaredDependency("vite", "vite", "%%SAPPORTA:VITE_VERSION%%", {
    browser: false,
    server: false,
  }),
  frontendDeclaredDependency(
    "viteReact",
    "@vitejs/plugin-react",
    "%%SAPPORTA:VITE_REACT_VERSION%%",
    { browser: false, server: false },
  ),
  frontendDeclaredDependency(
    "tailwindVite",
    "@tailwindcss/vite",
    "%%SAPPORTA:TAILWIND_VITE_VERSION%%",
    { browser: false, server: false },
  ),
  frontendDeclaredDependency(
    "tailwind",
    "tailwindcss",
    "%%SAPPORTA:TAILWIND_VERSION%%",
    { browser: false, server: false },
  ),
  frontendDeclaredDependency(
    "typesReact",
    "@types/react",
    "%%SAPPORTA:TYPES_REACT_VERSION%%",
    { browser: false, server: false },
  ),
  frontendDeclaredDependency(
    "typesReactDom",
    "@types/react-dom",
    "%%SAPPORTA:TYPES_REACT_DOM_VERSION%%",
    { browser: false, server: false },
  ),
  frontendInstalledDependency(
    "zustand",
    "zustand",
    "%%SAPPORTA:ZUSTAND_VERSION%%",
    { browser: true, server: false },
  ),
] as const satisfies readonly DependencyDefinition[];

export const DEPENDENCY_CATALOG: DependencyCatalog = {
  definitions: DEPENDENCY_DEFINITIONS,
  tokenByKey: tokensForCatalog(DEPENDENCY_DEFINITIONS),
};

/**
 * Returns complete definitions in catalog order. Rendering code can therefore
 * derive versions and diagnostics without maintaining a second package list.
 */
export function sharedRuntimeDefinitions(
  scope: RuntimeScope,
): readonly DependencyDefinition[] {
  return DEPENDENCY_DEFINITIONS.filter(
    (definition) => definition.sharedRuntime[scope],
  );
}

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
    sourceLinkMode: false,
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
    sourceLinkMode: true,
    pnpmOverrides: buildPnpmOverrides({
      devModePackageRoot: opts.devModePackageRoot,
      metadata,
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
  metadata: DevPackageMetadata;
  installedSpec: (fromPackageJsonPath: string, packageName: string) => string;
}): PnpmOverrides {
  // These overrides keep transitive @sapporta/* edges connected to the same
  // checkout as the generated project's direct `link:` dependencies. They
  // describe where framework source comes from, not runtime identity.
  const linkedSapportaOverrides: PnpmOverrides = {
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
  };

  // Browser and server selections overlap. Combine them by catalog key, then
  // walk the catalog once so one dependency produces one exact override and
  // output order remains stable. Exact alignment prevents pnpm from installing
  // a compatible-but-different version beside the generated project's copy.
  const selectedKeys = new Set(
    [
      ...sharedRuntimeDefinitions("browser"),
      ...sharedRuntimeDefinitions("server"),
    ].map((definition) => definition.key),
  );
  const sharedRuntimeOverrides: PnpmOverrides = {};
  for (const definition of DEPENDENCY_DEFINITIONS) {
    if (!selectedKeys.has(definition.key)) continue;
    sharedRuntimeOverrides[definition.packageName] =
      resolveExactSharedRuntimeDevSpec(definition, opts);
  }

  return { ...linkedSapportaOverrides, ...sharedRuntimeOverrides };
}

function resolveExactSharedRuntimeDevSpec(
  definition: DependencyDefinition,
  opts: {
    metadata: DevPackageMetadata;
    installedSpec: (fromPackageJsonPath: string, packageName: string) => string;
  },
): string {
  // Shared-runtime overrides must be exact. An installed development source
  // provides the resolved checkout version; a declared range would not prove
  // that the generated project and linked packages use the same version.
  if (definition.devSpec.kind !== "installed") {
    throw new Error(
      `Shared runtime dependency ${definition.packageName} must use an installed development version source.`,
    );
  }
  return opts.installedSpec(
    opts.metadata[definition.devSpec.sourcePackage].packageJsonPath,
    definition.packageName,
  );
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
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "sapporta", sourcePackage },
    { kind: "sapporta-link", sourcePackage },
    sharedRuntime,
  );
}

function coreInstalledDependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "core" },
    { kind: "installed", sourcePackage: "core" },
    sharedRuntime,
  );
}

function coreDeclaredDependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "core" },
    { kind: "declared", sourcePackage: "core" },
    sharedRuntime,
  );
}

function frontendInstalledDependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "frontend" },
    { kind: "installed", sourcePackage: "frontend" },
    sharedRuntime,
  );
}

function frontendDeclaredDependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return dependency(
    key,
    packageName,
    token,
    { kind: "declared", sourcePackage: "frontend" },
    { kind: "declared", sourcePackage: "frontend" },
    sharedRuntime,
  );
}

function dependency(
  key: DependencyKey,
  packageName: PackageName,
  token: TemplateToken | undefined,
  prodSpec: ProdSpecSource,
  devSpec: DevSpecSource,
  sharedRuntime: SharedRuntimeScopes,
): DependencyDefinition {
  return { key, packageName, token, prodSpec, devSpec, sharedRuntime };
}
