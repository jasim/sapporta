import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { devMode_sapportaSourcePackageJsonPath } from "./paths.js";

export type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version?: string;
};

export type PackageMetadata = {
  packageJsonPath: string;
  packageJson: PackageJson;
};

export type PackageSpec = string;
export type PackageSpecSource = "declared" | "installed-exact" | "sapporta";

export type SapportaSourcePackage =
  "core" | "frontend" | "grid" | "honest" | "shared" | "ui";

export function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
}

export function readPackageMetadata(packageJsonPath: string): PackageMetadata {
  return {
    packageJsonPath,
    packageJson: readPackageJson(packageJsonPath),
  };
}

export function readDevModeSapportaPackage(
  devModePackageRoot: string,
  packageName: SapportaSourcePackage,
): PackageMetadata {
  return readPackageMetadata(
    devMode_sapportaSourcePackageJsonPath(devModePackageRoot, packageName),
  );
}

export function resolveOwningPackage(
  moduleUrl: string,
  packageName: string,
): PackageMetadata {
  return readPackageMetadata(
    findPackageJsonForModule(fileURLToPath(moduleUrl), packageName),
  );
}

export function resolveInstalledPackage(
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

export function resolveInstalledPackageEntrypoint(
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
    if (isNodeError(error) && error.code === "MODULE_NOT_FOUND") {
      // Types-only packages (e.g. @types/*) declare no runtime entrypoint.
      // Their package.json still locates the installed copy; a genuinely
      // missing package fails this resolve with the same clear error.
      return packageRequire.resolve(`${packageName}/package.json`);
    }
    throw error;
  }
}

export function findPackageJsonForModule(
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

export function declaredPackageSpec(
  pkg: PackageJson,
  packageName: string,
): PackageSpec {
  const specs = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  const spec = specs[packageName];
  if (!spec) {
    throw new Error(
      `${pkg.name ?? "package"}'s package.json is missing "${packageName}" in dependencies/peerDependencies/devDependencies - cannot pin scaffolded dependencies.`,
    );
  }
  return spec;
}

export function exactVersionSpec(pkg: PackageMetadata): PackageSpec {
  const version = pkg.packageJson.version;
  if (!version) {
    throw new Error(
      `${pkg.packageJson.name ?? pkg.packageJsonPath}'s package.json is missing version - cannot pin scaffolded dependencies.`,
    );
  }
  return version;
}

export function sapportaPackageSpec(
  pkg: PackageJson,
  packageName: `@sapporta/${string}`,
): PackageSpec {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
