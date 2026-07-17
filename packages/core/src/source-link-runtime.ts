import { existsSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Source-linked development has two package roots: the generated API and the
 * Sapporta checkout. Shared dependencies must come from the generated API, but
 * globally preserving symlinks is too broad: it also preserves pnpm's internal
 * links and prevents transitive dependencies such as
 * `@js-temporal/polyfill -> jsbi` from reaching their package-store siblings.
 *
 * This preload keeps Node's normal realpath behavior and changes only bare
 * imports made by files in the linked Sapporta checkout. If the generated API
 * declares the imported package, Node resolves it from that API package. If it
 * does not, resolution continues from the Sapporta importer as usual. The API's
 * direct dependencies therefore define the singleton boundary without a second
 * runtime package list or an isolated checkout.
 *
 * Registry-generated projects never preload this module.
 */

const applicationPackageJsonPath = findApplicationPackageJson();
const applicationPackageJsonUrl = pathToFileURL(
  applicationPackageJsonPath,
).href;
const applicationDependencies = readDeclaredDependencies(
  applicationPackageJsonPath,
);
const sapportaPackagesRoot = realpathSync(
  resolve(import.meta.dirname, "..", ".."),
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const packageName = barePackageName(specifier);
    if (
      packageName === undefined ||
      !applicationDependencies.has(packageName) ||
      !isSapportaSourceImporter(context.parentURL)
    ) {
      return nextResolve(specifier, context);
    }

    return nextResolve(specifier, {
      ...context,
      parentURL: applicationPackageJsonUrl,
    });
  },
});

function findApplicationPackageJson(): string {
  const entryPath = process.argv[1]
    ? dirname(resolve(process.argv[1]))
    : process.cwd();
  let current = entryPath;

  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parent = dirname(current);
    if (parent === current || current === parse(current).root) {
      throw new Error(
        `Could not find the generated API package.json from ${entryPath}.`,
      );
    }
    current = parent;
  }
}

function readDeclaredDependencies(
  packageJsonPath: string,
): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected ${packageJsonPath} to contain a JSON object.`);
  }

  return new Set([
    ...dependencyNames(parsed.dependencies),
    ...dependencyNames(parsed.devDependencies),
  ]);
}

function dependencyNames(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function barePackageName(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.includes(":")
  ) {
    return undefined;
  }

  const segments = specifier.split("/");
  if (specifier.startsWith("@")) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }
  return segments[0] || undefined;
}

function isSapportaSourceImporter(parentUrl: string | undefined): boolean {
  if (!parentUrl?.startsWith("file:")) {
    return false;
  }

  const relativePath = relative(sapportaPackagesRoot, fileURLToPath(parentUrl));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}
