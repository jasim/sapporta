import { readFileSync } from "node:fs";
import path from "node:path";

export const SAPPORTA_SOURCE_CONDITION = "sapporta:source";

// Sapporta packages publish built JS through each export's `default` branch.
// The monorepo also records a private `sapporta:source` branch beside it, so
// local type-checks, tests, and dev servers can resolve the same public import
// specifiers to source files without hand-maintained tsconfig path maps.
export const sapportaSourceResolveConditions = [
  SAPPORTA_SOURCE_CONDITION,
  "module",
  "browser",
  "development|production",
];

export const sapportaSourceSsrResolveConditions = [
  SAPPORTA_SOURCE_CONDITION,
  "module",
  "node",
  "development|production",
];

const SAPPORTA_WORKSPACE_PACKAGE_DIRS = [
  "packages/core",
  "packages/honest",
  "packages/shared",
  "packages/ui",
  "packages/grid",
  "packages/frontend",
];

type PackageExportValue =
  | string
  | {
      [condition: string]: PackageExportValue | undefined;
    };

type PackageJson = {
  name?: string;
  exports?: Record<string, PackageExportValue>;
};

export type SapportaSourceAlias = {
  find: RegExp;
  replacement: string;
};

export type SapportaLibraryEntries = Record<string, string>;

// Some Vite/Vitest paths still need concrete aliases rather than only
// conditional resolution. Build those aliases from package exports so the
// package manifest stays the source of truth for every public subpath.
export function sapportaSourcePackageAliases(
  monorepoRoot: string,
): SapportaSourceAlias[] {
  const aliases: SapportaSourceAlias[] = [];

  for (const packageDir of SAPPORTA_WORKSPACE_PACKAGE_DIRS) {
    const packageRoot = path.resolve(monorepoRoot, packageDir);
    const packageJson = readPackageJson(path.join(packageRoot, "package.json"));
    if (!packageJson.name || !packageJson.exports) continue;

    for (const [subpath, exportValue] of Object.entries(packageJson.exports)) {
      if (subpath === "./package.json") continue;

      const sourceTarget = sourceTargetFor(exportValue);
      if (!sourceTarget) continue;

      const specifier =
        subpath === "."
          ? packageJson.name
          : `${packageJson.name}/${subpath.slice(2)}`;

      aliases.push({
        find: exactSpecifierPattern(specifier),
        replacement: path.resolve(packageRoot, sourceTarget),
      });
    }
  }

  return aliases.sort(
    (left, right) => right.find.source.length - left.find.source.length,
  );
}

export function sapportaLibraryEntries(
  packageRoot: string,
): SapportaLibraryEntries {
  const packageJson = readPackageJson(path.join(packageRoot, "package.json"));
  const entries: SapportaLibraryEntries = {};

  for (const [subpath, exportValue] of Object.entries(
    packageJson.exports ?? {},
  )) {
    if (subpath === "./package.json") continue;

    // JS library entries mirror the public export map. CSS exports stay assets,
    // so they are intentionally excluded from the Rollup entry object.
    const sourceTarget = sourceTargetFor(exportValue);
    if (!sourceTarget || !isTypeScriptSourceTarget(sourceTarget)) continue;

    entries[entryNameForSubpath(subpath)] = path.resolve(
      packageRoot,
      sourceTarget,
    );
  }

  return entries;
}

function readPackageJson(packageJsonPath: string): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function sourceTargetFor(exportValue: PackageExportValue): string | undefined {
  if (typeof exportValue === "string") return undefined;

  const sourceTarget = exportValue[SAPPORTA_SOURCE_CONDITION];
  return typeof sourceTarget === "string" ? sourceTarget : undefined;
}

function isTypeScriptSourceTarget(sourceTarget: string): boolean {
  return sourceTarget.endsWith(".ts") || sourceTarget.endsWith(".tsx");
}

function entryNameForSubpath(subpath: string): string {
  return subpath === "." ? "index" : subpath.slice(2);
}

function exactSpecifierPattern(specifier: string): RegExp {
  return new RegExp(`^${escapeRegExp(specifier)}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
