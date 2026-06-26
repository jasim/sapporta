import { readFileSync } from "node:fs";
import path from "node:path";

export const SAPPORTA_SOURCE_CONDITION = "sapporta:source";

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

function readPackageJson(packageJsonPath: string): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function sourceTargetFor(exportValue: PackageExportValue): string | undefined {
  if (typeof exportValue === "string") return undefined;

  const sourceTarget = exportValue[SAPPORTA_SOURCE_CONDITION];
  return typeof sourceTarget === "string" ? sourceTarget : undefined;
}

function exactSpecifierPattern(specifier: string): RegExp {
  return new RegExp(`^${escapeRegExp(specifier)}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
