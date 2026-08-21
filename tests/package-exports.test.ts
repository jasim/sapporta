import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

const sapportaPackages = [
  { packageDir: "packages/core", snapshotDir: undefined },
  {
    packageDir: "packages/honest",
    snapshotDir:
      "packages/core/src/templates/dependency-package-snapshots/honest",
  },
  {
    packageDir: "packages/shared",
    snapshotDir:
      "packages/core/src/templates/dependency-package-snapshots/shared",
  },
  {
    packageDir: "packages/frontend",
    snapshotDir:
      "packages/core/src/templates/dependency-package-snapshots/frontend",
  },
  {
    packageDir: "packages/grid",
    snapshotDir:
      "packages/core/src/templates/dependency-package-snapshots/grid",
  },
  {
    packageDir: "packages/ui",
    snapshotDir: "packages/core/src/templates/dependency-package-snapshots/ui",
  },
] as const;

type PackageJson = {
  name: string;
  exports?: Record<string, PackageExport>;
};

type PackageExport =
  | string
  | {
      types?: unknown;
      "sapporta:source"?: unknown;
      default?: unknown;
      import?: unknown;
      require?: unknown;
    };

type PackageUnderTest = {
  name: string;
  root: string;
  packageJson: PackageJson;
};

type JsExportUnderTest = {
  packageName: string;
  packageRoot: string;
  specifier: string;
  subpath: string;
  types: string;
  source: string;
  runtime: string;
};

type ResolutionResult = {
  specifier: string;
  importPath: string;
  requirePath: string;
};

describe("Sapporta package exports", () => {
  it("uses types, sapporta:source, and default for every public JS export", () => {
    for (const pkg of readPackages()) {
      const exports = pkg.packageJson.exports;
      expect(exports, `${pkg.name} must define exports`).toBeDefined();

      for (const [subpath, exportValue] of Object.entries(exports ?? {})) {
        if (typeof exportValue === "string") {
          expect(subpath).toBe("./package.json");
          expect(exportValue).toBe("./package.json");
          continue;
        }

        expect(exportValue.require, `${pkg.name}${subpath}`).toBeUndefined();
        expect(exportValue.import, `${pkg.name}${subpath}`).toBeUndefined();

        if (isCssExport(exportValue)) {
          expect(Object.keys(exportValue)).toEqual([
            "sapporta:source",
            "default",
          ]);
          expect(exportValue["sapporta:source"]).toEqual(
            expect.stringMatching(/^\.\/src\/.*\.css$/),
          );
          expect(exportValue.default).toEqual(
            expect.stringMatching(/^\.\/dist\/.*\.css$/),
          );
          continue;
        }

        expect(Object.keys(exportValue), `${pkg.name}${subpath}`).toEqual([
          "types",
          "sapporta:source",
          "default",
        ]);
        expect(exportValue.types, `${pkg.name}${subpath} types`).toEqual(
          expect.stringMatching(/^\.\/dist\/.*\.d\.ts$/),
        );
        expect(
          exportValue["sapporta:source"],
          `${pkg.name}${subpath} source`,
        ).toEqual(expect.stringMatching(/^\.\/src\/.*\.(ts|tsx)$/));
        expect(exportValue.default, `${pkg.name}${subpath} default`).toEqual(
          expect.stringMatching(/^\.\/dist\/.*\.js$/),
        );
      }
    }
  });

  it("points every export target at an existing source or built file", () => {
    for (const exportTarget of jsExports()) {
      expectTargetExists(exportTarget.packageRoot, exportTarget.types);
      expectTargetExists(exportTarget.packageRoot, exportTarget.source);
      expectTargetExists(exportTarget.packageRoot, exportTarget.runtime);
    }

    for (const pkg of readPackages()) {
      for (const exportValue of Object.values(pkg.packageJson.exports ?? {})) {
        if (typeof exportValue === "string" || !isCssExport(exportValue)) {
          continue;
        }
        expectTargetExists(
          pkg.root,
          stringCondition(exportValue, "sapporta:source"),
        );
        expectTargetExists(pkg.root, stringCondition(exportValue, "default"));
      }
    }
  });

  it("resolves every public JS export with import.meta.resolve and require.resolve", () => {
    const tempProject = createLinkedConsumerProject();
    try {
      const exports = jsExports();
      const results = resolveSpecifiersInProject(
        tempProject,
        exports.map((exportTarget) => exportTarget.specifier),
      );
      const bySpecifier = new Map(
        results.map((result) => [result.specifier, result]),
      );

      for (const exportTarget of exports) {
        const result = bySpecifier.get(exportTarget.specifier);
        expect(result, exportTarget.specifier).toBeDefined();
        const expectedPath = realpathSync(
          path.join(exportTarget.packageRoot, exportTarget.runtime),
        );
        expect(realpathSync(result?.importPath ?? "")).toBe(expectedPath);
        expect(realpathSync(result?.requirePath ?? "")).toBe(expectedPath);
      }
    } finally {
      rmSync(tempProject, { force: true, recursive: true });
    }
  });

  it("resolves representative public exports to source files with sapporta:source", () => {
    const tempProject = createLinkedConsumerProject();
    try {
      const representativeSpecifiers = [
        "@sapporta/ui/alert-dialog",
        "@sapporta/ui/button",
        "@sapporta/ui/context-menu",
        "@sapporta/ui/tooltip",
        "@sapporta/shared/csv",
        "@sapporta/shared/filter",
        "@sapporta/grid/lookup/react",
      ];
      const sourceBySpecifier = new Map(
        jsExports().map((exportTarget) => [
          exportTarget.specifier,
          exportTarget,
        ]),
      );
      const results = resolveSourceSpecifiersInProject(
        tempProject,
        representativeSpecifiers,
      );

      for (const result of results) {
        const exportTarget = sourceBySpecifier.get(result.specifier);
        if (!exportTarget) {
          throw new Error(`Missing export target for ${result.specifier}.`);
        }
        const expectedPath = realpathSync(
          path.join(exportTarget.packageRoot, exportTarget.source),
        );
        expect(realpathSync(result.importPath)).toBe(expectedPath);
      }
    } finally {
      rmSync(tempProject, { force: true, recursive: true });
    }
  });

  it("type-checks representative NodeNext and bundler consumers", () => {
    const tempProject = createLinkedConsumerProject();
    try {
      typeCheckConsumer(tempProject, "api-consumer", {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        source: `
          import {
            resolveCountQuery,
            resolveExportQuery,
            resolveLookupQuery,
            resolvePageQuery,
            scanTableRows,
            type ResolvedCountQuery,
            type ResolveRowsQueryOptions,
            type TableRowScanInput,
            type TableRowScanOrder,
          } from "@sapporta/server";
          import { sapportaTable, sqliteTable, text, integer } from "@sapporta/server/table";
          import * as shared from "@sapporta/shared";
          import * as filters from "@sapporta/shared/filter";
          import * as contracts from "@sapporta/shared/contracts";
          import * as rowIds from "@sapporta/shared/row-id";

          const accountsDrizzle = sqliteTable("accounts", {
            id: integer("id").primaryKey(),
            name: text("name").notNull(),
          });
          export const accounts = sapportaTable({
            drizzle: accountsDrizzle,
            meta: { rowLabelColumns: ["name"] },
          });
          export {
            resolveCountQuery,
            resolveExportQuery,
            resolveLookupQuery,
            resolvePageQuery,
            scanTableRows,
          };
          export type {
            ResolvedCountQuery,
            ResolveRowsQueryOptions,
            TableRowScanInput,
            TableRowScanOrder,
          };
          export { sqliteTable, shared, filters, contracts, rowIds };
        `,
      });

      typeCheckConsumer(tempProject, "browser-consumer", {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: [],
        },
        source: `
          import * as frontend from "@sapporta/frontend";
          import * as frontendApp from "@sapporta/frontend/app";
          import * as frontendAuthProfile from "@sapporta/frontend/auth/profile";
          import * as frontendForm from "@sapporta/frontend/form";
          import * as frontendTableQuery from "@sapporta/frontend/table/query";
          import * as grid from "@sapporta/grid";
          import * as gridColumnPreset from "@sapporta/grid/column-preset";
          import * as ui from "@sapporta/ui";
          import * as uiAlertDialog from "@sapporta/ui/alert-dialog";
          import * as uiButton from "@sapporta/ui/button";
          import * as uiContextMenu from "@sapporta/ui/context-menu";
          import * as uiCn from "@sapporta/ui/cn";
          import * as uiPopover from "@sapporta/ui/popover";
          import * as uiTooltip from "@sapporta/ui/tooltip";
          import * as shared from "@sapporta/shared";
          import * as sharedCsv from "@sapporta/shared/csv";
          import * as contracts from "@sapporta/shared/contracts";
          import * as sharedError from "@sapporta/shared/error";
          import * as sharedValidation from "@sapporta/shared/validation";

          export {
            frontend,
            frontendApp,
            frontendAuthProfile,
            frontendForm,
            frontendTableQuery,
            grid,
            gridColumnPreset,
            ui,
            uiAlertDialog,
            uiButton,
            uiContextMenu,
            uiCn,
            uiPopover,
            uiTooltip,
            shared,
            sharedCsv,
            sharedError,
            sharedValidation,
            contracts,
          };
        `,
      });
    } finally {
      rmSync(tempProject, { force: true, recursive: true });
    }
  });

  it("keeps vendored dependency package snapshots in sync with source manifests", () => {
    for (const { packageDir, snapshotDir } of sapportaPackages) {
      if (!snapshotDir) continue;

      const source = readFileSync(
        path.join(repoRoot, packageDir, "package.json"),
        "utf8",
      );
      const snapshot = readFileSync(
        path.join(repoRoot, snapshotDir, "package.json"),
        "utf8",
      );
      expect(snapshot, snapshotDir).toBe(source);
    }
  });
});

function readPackages(): PackageUnderTest[] {
  return sapportaPackages.map(({ packageDir }) => {
    const root = path.join(repoRoot, packageDir);
    const packageJson = parsePackageJson(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    return { name: packageJson.name, root, packageJson };
  });
}

function jsExports(): JsExportUnderTest[] {
  return readPackages().flatMap((pkg) => {
    const exports = pkg.packageJson.exports ?? {};
    return Object.entries(exports).flatMap(([subpath, exportValue]) => {
      if (typeof exportValue === "string" || isCssExport(exportValue)) {
        return [];
      }

      return [
        {
          packageName: pkg.name,
          packageRoot: pkg.root,
          specifier:
            subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
          subpath,
          types: stringCondition(exportValue, "types"),
          source: stringCondition(exportValue, "sapporta:source"),
          runtime: stringCondition(exportValue, "default"),
        },
      ];
    });
  });
}

function parsePackageJson(content: string): PackageJson {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed) || typeof parsed.name !== "string") {
    throw new Error("Expected package.json with a string name.");
  }

  if (parsed.exports !== undefined && !isRecord(parsed.exports)) {
    throw new Error(`Expected ${parsed.name} exports to be an object.`);
  }

  return parsed as PackageJson;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCssExport(
  exportValue: Exclude<PackageExport, string>,
): exportValue is { "sapporta:source": string; default: string } {
  return (
    typeof exportValue["sapporta:source"] === "string" &&
    exportValue["sapporta:source"].endsWith(".css") &&
    typeof exportValue.default === "string" &&
    exportValue.default.endsWith(".css")
  );
}

function stringCondition(
  exportValue: Exclude<PackageExport, string>,
  condition: "types" | "sapporta:source" | "default",
): string {
  const value = exportValue[condition];
  if (typeof value !== "string") {
    throw new Error(`Expected export condition ${condition} to be a string.`);
  }
  return value;
}

function expectTargetExists(packageRoot: string, target: string): void {
  const absolutePath = path.join(packageRoot, target);
  expect(
    existsSync(absolutePath),
    `${path.relative(repoRoot, absolutePath)} should exist. Run pnpm build before this smoke test.`,
  ).toBe(true);
}

function createLinkedConsumerProject(): string {
  const tempProject = mkdtempSync(path.join(tmpdir(), "sapporta-exports-"));
  const scopeDir = path.join(tempProject, "node_modules", "@sapporta");
  mkdirSync(scopeDir, { recursive: true });

  for (const pkg of readPackages()) {
    const packageName = pkg.name.replace("@sapporta/", "");
    symlinkSync(pkg.root, path.join(scopeDir, packageName), "dir");
  }

  writeFileSync(
    path.join(tempProject, "package.json"),
    JSON.stringify(
      { name: "sapporta-export-consumer", type: "module" },
      null,
      2,
    ),
  );

  return tempProject;
}

function resolveSpecifiersInProject(
  projectRoot: string,
  specifiers: string[],
): ResolutionResult[] {
  const scriptPath = path.join(projectRoot, "resolve.mjs");
  writeFileSync(
    scriptPath,
    `
      import { createRequire } from "node:module";
      import { fileURLToPath } from "node:url";

      const requireFromProject = createRequire(new URL("./package.json", import.meta.url));
      const specifiers = ${JSON.stringify(specifiers)};
      const results = [];

      for (const specifier of specifiers) {
        results.push({
          specifier,
          importPath: fileURLToPath(await import.meta.resolve(specifier)),
          requirePath: requireFromProject.resolve(specifier),
        });
      }

      console.log(JSON.stringify(results));
    `,
  );

  const output = execFileSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return JSON.parse(output) as ResolutionResult[];
}

function resolveSourceSpecifiersInProject(
  projectRoot: string,
  specifiers: string[],
): Pick<ResolutionResult, "specifier" | "importPath">[] {
  const scriptPath = path.join(projectRoot, "resolve-source.mjs");
  writeFileSync(
    scriptPath,
    `
      import { fileURLToPath } from "node:url";

      const specifiers = ${JSON.stringify(specifiers)};
      const results = [];

      for (const specifier of specifiers) {
        results.push({
          specifier,
          importPath: fileURLToPath(await import.meta.resolve(specifier)),
        });
      }

      console.log(JSON.stringify(results));
    `,
  );

  const output = execFileSync(
    process.execPath,
    ["--conditions=sapporta:source", scriptPath],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
  return JSON.parse(output) as Pick<
    ResolutionResult,
    "specifier" | "importPath"
  >[];
}

function typeCheckConsumer(
  projectRoot: string,
  name: string,
  input: {
    compilerOptions: Record<string, unknown>;
    source: string;
  },
): void {
  const consumerRoot = path.join(projectRoot, name);
  mkdirSync(consumerRoot);
  writeFileSync(path.join(consumerRoot, "main.ts"), input.source);
  writeFileSync(
    path.join(consumerRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: input.compilerOptions,
        files: ["main.ts"],
      },
      null,
      2,
    ),
  );

  const tscBin = path.join(repoRoot, "node_modules/typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [tscBin, "-p", consumerRoot], {
      cwd: consumerRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(commandErrorMessage(`tsc ${name}`, error));
  }
}

function commandErrorMessage(label: string, error: unknown): string {
  if (!isRecord(error)) return `${label} failed: ${String(error)}`;

  const output = ["stdout", "stderr"]
    .map((key) => [key, error[key]] as const)
    .map(([key, value]) => {
      if (typeof value === "string") return `${key}:\n${value}`;
      if (Buffer.isBuffer(value)) return `${key}:\n${value.toString("utf8")}`;
      return undefined;
    })
    .filter((value): value is string => value !== undefined)
    .join("\n");

  return output ? `${label} failed\n${output}` : `${label} failed`;
}
