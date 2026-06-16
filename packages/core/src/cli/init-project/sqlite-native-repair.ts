import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const BETTER_SQLITE3_PACKAGE = "better-sqlite3";
const SQLITE_SMOKE_SCRIPT = `
const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.prepare("select 1 as ok").get();
db.close();
`;

type ProgressLogger = (message: string) => void;

export type CommandResult = Pick<
  SpawnSyncReturns<string>,
  "status" | "signal" | "stdout" | "stderr" | "error"
>;

export type SqliteSmokeClassification =
  | "success"
  | "missing-native-binding"
  | "command-failure";

function runCommand(
  packageDir: string,
  command: string,
  args: string[],
  stdio: "pipe" | "inherit" = "pipe",
): CommandResult {
  return spawnSync(command, args, {
    cwd: packageDir,
    encoding: "utf-8",
    stdio,
  });
}

function assertSuccessfulCommand(
  result: CommandResult,
  command: string,
  args: readonly string[],
): void {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result, command, args));
  }
}

export function classifySmokeResult(
  result: CommandResult,
): SqliteSmokeClassification {
  if (result.status === 0) {
    return "success";
  }
  return isMissingBetterSqlite3Binding(result)
    ? "missing-native-binding"
    : "command-failure";
}

export function isMissingBetterSqlite3Binding(result: CommandResult): boolean {
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n");
  return (
    output.includes("Could not locate the bindings file") ||
    output.includes("better_sqlite3.node")
  );
}

function formatCommandFailure(
  result: CommandResult,
  command: string,
  args: readonly string[],
): string {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  return `${commandText(command, args)} failed with status ${
    result.status ?? `signal ${result.signal}`
  }${output ? `:\n${output}` : ""}`;
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

export function resolveBetterSqlite3Install(packageDir: string): {
  dir: string;
  version: string;
} {
  const projectRequire = createRequire(join(packageDir, "package.json"));
  const packageJsonPath = projectRequire.resolve(
    `${BETTER_SQLITE3_PACKAGE}/package.json`,
  );
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    name?: string;
    version?: string;
  };
  if (pkg.name !== BETTER_SQLITE3_PACKAGE || !pkg.version) {
    throw new Error(
      `Resolved ${packageJsonPath}, but it is not a valid ${BETTER_SQLITE3_PACKAGE} package.json.`,
    );
  }
  return { dir: dirname(packageJsonPath), version: pkg.version };
}

function smokeTestBetterSqlite3(packageDir: string): CommandResult {
  return runCommand(packageDir, process.execPath, ["-e", SQLITE_SMOKE_SCRIPT]);
}

function repairBetterSqlite3Binding(
  packageDir: string,
  progress: ProgressLogger,
): void {
  progress(
    "better-sqlite3 could not load its native binding from the generated API package; repairing the install",
  );

  const approveArgs = ["approve-builds", BETTER_SQLITE3_PACKAGE];
  progress("Approving better-sqlite3 build scripts with pnpm approve-builds");
  const approveResult = runCommand(packageDir, "pnpm", approveArgs, "inherit");
  assertSuccessfulCommand(approveResult, "pnpm", approveArgs);

  const rebuildArgs = ["rebuild", BETTER_SQLITE3_PACKAGE];
  progress("Rebuilding better-sqlite3 native bindings with pnpm rebuild");
  const rebuildResult = runCommand(packageDir, "pnpm", rebuildArgs, "inherit");
  assertSuccessfulCommand(rebuildResult, "pnpm", rebuildArgs);

  let smokeResult = smokeTestBetterSqlite3(packageDir);
  if (smokeResult.status === 0) {
    return;
  }
  if (!isMissingBetterSqlite3Binding(smokeResult)) {
    assertSuccessfulCommand(smokeResult, process.execPath, [
      "-e",
      SQLITE_SMOKE_SCRIPT,
    ]);
  }

  const installed = resolveBetterSqlite3Install(packageDir);
  progress(
    `pnpm rebuild did not produce a loadable binding; building ${BETTER_SQLITE3_PACKAGE}@${installed.version} directly with node-gyp`,
  );
  const directBuildArgs = ["--yes", "node-gyp", "rebuild", "--release"];
  const directBuildResult = runCommand(
    installed.dir,
    "npx",
    directBuildArgs,
    "inherit",
  );
  assertSuccessfulCommand(directBuildResult, "npx", directBuildArgs);

  progress("Verifying the repaired better-sqlite3 binding can load");
  smokeResult = smokeTestBetterSqlite3(packageDir);
  assertSuccessfulCommand(smokeResult, process.execPath, [
    "-e",
    SQLITE_SMOKE_SCRIPT,
  ]);
}

export function ensureBetterSqlite3Loads(
  packageDir: string,
  progress: ProgressLogger = console.log,
): void {
  progress(
    "Checking better-sqlite3 can open an in-memory SQLite database from the generated API package",
  );
  const smokeResult = smokeTestBetterSqlite3(packageDir);
  const classification = classifySmokeResult(smokeResult);
  if (classification === "success") {
    progress("better-sqlite3 loaded successfully; migrations can use SQLite");
    return;
  }
  if (classification === "command-failure") {
    assertSuccessfulCommand(smokeResult, process.execPath, [
      "-e",
      SQLITE_SMOKE_SCRIPT,
    ]);
  }
  repairBetterSqlite3Binding(packageDir, progress);
}
