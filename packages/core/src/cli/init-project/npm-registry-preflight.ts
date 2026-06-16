import { ErrorCode } from "../../introspect/types.js";
import {
  errorMessage,
  formatCommand,
  InitSetupError,
  type InitCommandRunner,
  type ProgressLogger,
} from "./init-shell.js";
import type { RenderedScaffoldFile } from "./template-rendering.js";
import { preflightDependencyDefinition } from "./dependency-catalog.js";
import { projectNameForMessage } from "./project-layout.js";

type PackageJsonForPreflight = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export type NpmRegistryPreflightOptions = {
  files: readonly RenderedScaffoldFile[];
  targetRoot: string;
  runCommand: InitCommandRunner;
  progress: ProgressLogger;
};

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

export function assertNpmRegistryReachable(
  opts: NpmRegistryPreflightOptions,
): void {
  const dependency = findRegistryPreflightDependency(opts.files);

  opts.progress(
    `Checking npm registry access with ${dependency.name}@${dependency.spec}`,
  );

  const args = [
    "view",
    dependency.resolutionSpec,
    "version",
    "--json",
  ] as const;
  try {
    opts.runCommand("pnpm", args, { stdio: "ignore" });
  } catch (error) {
    throw new InitSetupError(
      "npm-registry-preflight",
      [
        "Sapporta init needs npm registry access before it can create this project.",
        "The npm registry check failed while resolving a generated project dependency.",
        `Failed dependency: ${dependency.name}@${dependency.spec}`,
        `Command: ${formatCommand("pnpm", args)}`,
        `Cause: ${errorMessage(error)}`,
        `Retry the full \`sapporta init ${projectNameForMessage(opts.targetRoot)}\` command with network/npm-registry access.`,
        `No project files were written to ${opts.targetRoot}.`,
      ].join("\n"),
      ErrorCode.INIT_NPM_REGISTRY_UNAVAILABLE,
    );
  }
}

function findRegistryPreflightDependency(
  files: readonly RenderedScaffoldFile[],
): { name: string; spec: string; resolutionSpec: string } {
  const preflightDependency = preflightDependencyDefinition();
  const packages = files
    .filter((file) => file.dest.endsWith("package.json"))
    .map((file) => parsePackageJson(file.content, file.dest));

  for (const pkg of packages) {
    for (const field of DEPENDENCY_FIELDS) {
      const spec = pkg[field]?.[preflightDependency.packageName];
      if (spec) {
        return {
          name: preflightDependency.packageName,
          spec,
          resolutionSpec: `${preflightDependency.packageName}@${spec}`,
        };
      }
    }
  }

  throw new InitSetupError(
    "npm-registry-preflight",
    `Cannot run the npm registry preflight because the generated scaffold did not include ${preflightDependency.packageName}.`,
    ErrorCode.INIT_SETUP_FAILED,
  );
}

function parsePackageJson(
  content: string,
  filename: string,
): PackageJsonForPreflight {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filename} must contain a JSON object.`);
  }
  return parsed as PackageJsonForPreflight;
}
