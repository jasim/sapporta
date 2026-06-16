import { ErrorCode } from "../../introspect/types.js";
import {
  errorMessage,
  formatCommand,
  InitSetupError,
  type InitCommandRunner,
  type ProgressLogger,
} from "./init-shell.js";
import { projectNameForMessage } from "./project-layout.js";

export type NpmRegistryPreflightOptions = {
  targetRoot: string;
  runCommand: InitCommandRunner;
  progress: ProgressLogger;
};

const NPM_REGISTRY_PREFLIGHT_PACKAGE = "hono";
const NPM_REGISTRY_PREFLIGHT_SPEC = "latest";
const NPM_REGISTRY_PREFLIGHT_RESOLUTION_SPEC = `${NPM_REGISTRY_PREFLIGHT_PACKAGE}@${NPM_REGISTRY_PREFLIGHT_SPEC}`;

export function assertNpmRegistryReachable(
  opts: NpmRegistryPreflightOptions,
): void {
  opts.progress(
    `Checking npm registry access with ${NPM_REGISTRY_PREFLIGHT_RESOLUTION_SPEC}`,
  );

  const args = [
    "view",
    NPM_REGISTRY_PREFLIGHT_RESOLUTION_SPEC,
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
        "The npm registry check failed while running a minimal package lookup.",
        `Registry probe: ${NPM_REGISTRY_PREFLIGHT_RESOLUTION_SPEC}`,
        `Command: ${formatCommand("pnpm", args)}`,
        `Cause: ${errorMessage(error)}`,
        `Retry the full \`sapporta init ${projectNameForMessage(opts.targetRoot)}\` command with network/npm-registry access.`,
        `No project files were written to ${opts.targetRoot}.`,
      ].join("\n"),
      ErrorCode.INIT_NPM_REGISTRY_UNAVAILABLE,
    );
  }
}
