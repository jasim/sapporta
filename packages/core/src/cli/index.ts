import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLI_COMMANDS } from "./commands/registry.js";
import { createCliProgram } from "./commands/framework.js";

export { CLI_COMMANDS } from "./commands/registry.js";
export { createCliProgram } from "./commands/framework.js";
export type {
  CliCommandContext,
  CliCommandResult,
  CliCommandSpec,
} from "./commands/types.js";
export { SapportaCliClient } from "./client/app-client.js";

function readCliPackageVersion(): string {
  const packageJsonPath = resolve(
    import.meta.dirname,
    "..",
    "vendored-package-snapshots",
    "cli",
    "package.json",
  );
  const parsedPackageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf-8"),
  ) as unknown;

  if (typeof parsedPackageJson !== "object" || parsedPackageJson === null) {
    throw new Error(`${packageJsonPath} must contain a JSON object.`);
  }

  const packageJson = parsedPackageJson as Record<string, unknown>;
  if (packageJson.name !== "sapporta") {
    throw new Error(
      `Expected vendored sapporta package metadata, got ${String(packageJson.name)}.`,
    );
  }
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error(`${packageJsonPath} is missing a package version.`);
  }

  return packageJson.version;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const program = createCliProgram(readCliPackageVersion(), CLI_COMMANDS);
  if (rawArgs.length === 0) {
    program.help();
  }
  await program.parseAsync(process.argv);
}

main();
