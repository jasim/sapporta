import { join, resolve } from "node:path";

type SapportaSourcePackage =
  "core" | "frontend" | "grid" | "honest" | "shared" | "ui";

const SAPPORTA_SOURCE_PACKAGES_DIR = "packages";

/**
 * Relative path from this init-project module directory to the template
 * directory shipped with @sapporta/server.
 *
 * Templates are real TypeScript/JSON files with placeholder tokens
 * (%%SAPPORTA:SLUG%%, %%SAPPORTA:NAME%%, etc.) that get replaced at scaffold time via
 * replaceAll(). Keep this relative layout here so moving the init-project
 * implementation only requires updating this one constant.
 */
const TEMPLATES_DIR_FROM_INIT_PROJECT = ["..", "..", "templates"] as const;
const DEPENDENCY_PACKAGE_SNAPSHOTS_DIR = "dependency-package-snapshots";

/**
 * Absolute paths for assets shipped inside @sapporta/server's init-project
 * implementation.
 */
export function initProjectPackagePaths(
  initProjectDir: string = import.meta.dirname,
) {
  const templatesDir = resolve(
    initProjectDir,
    ...TEMPLATES_DIR_FROM_INIT_PROJECT,
  );

  return {
    templatesDir,
    templatePath: (filename: string) => join(templatesDir, filename),
    vendoredPackageJsonPath: (shortName: string) =>
      join(
        templatesDir,
        DEPENDENCY_PACKAGE_SNAPSHOTS_DIR,
        shortName,
        "package.json",
      ),
  };
}

/**
 * Paths to Sapporta packages in a source checkout used by
 * SAPPORTA_PACKAGE_ROOT. Source-mode scaffolds symlink these packages
 * via link: specs so init can be tested directly from the monorepo and pick up
 * newly created build output without reinstalling.
 */
export function devMode_sapportaSourcePackageDir(
  sourceRoot: string,
  packageName: SapportaSourcePackage,
): string {
  return join(sourceRoot, SAPPORTA_SOURCE_PACKAGES_DIR, packageName);
}

export function devMode_sapportaSourcePackageJsonPath(
  sourceRoot: string,
  packageName: SapportaSourcePackage,
): string {
  return join(
    devMode_sapportaSourcePackageDir(sourceRoot, packageName),
    "package.json",
  );
}

// Returns the link: spec for linking dev mode packages from the root source path.
export function devMode_sapportaSourcePackageLinkSpec(
  sourceRoot: string,
  packageName: SapportaSourcePackage,
): string {
  return `link:${resolve(
    devMode_sapportaSourcePackageDir(sourceRoot, packageName),
  )}`;
}
