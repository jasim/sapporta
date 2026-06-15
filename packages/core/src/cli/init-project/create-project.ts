import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { ErrorCode, OperationError } from "../../introspect/types.js";
import { fromProjectRoot } from "../../project-paths.js";
import { ensureBetterSqlite3Loads } from "./sqlite-native-repair.js";
import {
  logInitDetail,
  logInitSection,
  noopProgress,
  type ProgressLogger,
} from "./init-progress.js";
import {
  formatCommand,
  runInitCommand,
  type InitCommandRunner,
} from "./init-commands.js";
import {
  errorMessage,
  InitSetupError,
  type InitSetupStep,
} from "./init-errors.js";
import { assertNpmRegistryReachable } from "./npm-registry-preflight.js";
import {
  renderScaffoldFiles,
  resolveScaffoldPackages,
  resolveOwningPackage,
  scaffoldProjectFromOptions,
  type ScaffoldPackages,
  type ScaffoldProject,
} from "./render-scaffold.js";

export { resolveOwningPackage, resolveScaffoldPackages };
export type { ScaffoldPackages };

export interface CreateProjectOptions {
  /** Absolute path to the project root that should be published on success. */
  dir: string;
  /** Project name for package.json. Defaults to the directory basename. */
  name?: string;
  /** Optional hook for CLI progress messages while long-running setup runs. */
  progress?: ProgressLogger;
  /** Test hook for commands that would otherwise reach the shell or network. */
  runCommand?: InitCommandRunner;
  /** Test hook for the better-sqlite3 native binding verification step. */
  verifySqlite?: (apiDir: string, progress: ProgressLogger) => void;
}

export interface CreateProjectResult {
  dir: string;
  name: string;
}

/**
 * Create a Sapporta code project: writes workspace package files, boot.ts,
 * app.ts, package.json, tsconfig.json from templates and installs dependencies.
 *
 * `dir` is the requested project root. Backend code lives in packages/api,
 * with packages/frontend and packages/shared beside it.
 *
 * This is the SDK function - no CLI arg parsing, no OperationResult wrapping.
 *
 * Throws if the requested target path already exists.
 */
export function createProject(opts: CreateProjectOptions): CreateProjectResult {
  const progress = opts.progress ?? noopProgress;
  const runCommand = opts.runCommand ?? runInitCommand;
  const verifySqlite =
    opts.verifySqlite ??
    ((apiDir, sqliteProgress) =>
      ensureBetterSqlite3Loads(apiDir, sqliteProgress));
  const project = scaffoldProjectFromOptions(opts);

  logInitSection(progress, "Preparing the generated workspace scaffold");
  assertCanCreateProject(project);
  logInitDetail(progress, "Checking pnpm is available for workspace installs");
  assertPnpmAvailable(runCommand);

  logInitDetail(
    progress,
    "Resolving Sapporta package versions for the new project's package.json files",
  );
  const files = renderScaffoldFiles(
    project,
    process.env.SAPPORTA_DEV_MODE_PACKAGE_ROOT,
  );

  logInitDetail(
    progress,
    "Checking that npm can resolve the generated workspace dependencies before writing project files",
  );
  assertNpmRegistryReachable({
    files,
    targetRoot: project.root,
    runCommand,
    progress: (message) => logInitDetail(progress, message),
  });

  const stagingRoot = makeStagingRoot(project.root);
  const stagedProject = scaffoldProjectFromOptions({
    dir: stagingRoot,
    name: project.name,
  });

  try {
    logInitSection(progress, "Creating the Sapporta project directory");
    logInitDetail(progress, `Project directory: ${project.root}`);
    logInitDetail(progress, `Staging directory: ${stagingRoot}`);
    runSetupStep({
      step: "scaffold-write",
      command: "write generated project files",
      project,
      stagingRoot,
      action: () => {
        writeProjectMarker(stagedProject);
        logInitDetail(
          progress,
          "Creating packages/api, packages/frontend, packages/shared, and support directories",
        );
        createScaffoldDirectories(stagedProject);
        logInitDetail(
          progress,
          "Writing TypeScript, Vite, Drizzle, auth, and package configuration files",
        );
        writeScaffoldFiles(stagedProject.root, files);
      },
    });

    installWorkspace(stagedProject.root, project, runCommand, progress);
    logInitSection(progress, "Verifying SQLite native bindings");
    runSetupStep({
      step: "sqlite-native-bindings",
      command: "better-sqlite3 smoke test and repair",
      project,
      stagingRoot,
      action: () =>
        verifySqlite(stagedProject.apiDir, (message) =>
          logInitDetail(progress, message),
        ),
    });
    generateInitialMigration(stagedProject.root, project, runCommand, progress);
    runInitialMigration(stagedProject.root, project, runCommand, progress);
    publishStagingDirectory(stagingRoot, project);
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    if (error instanceof OperationError) {
      throw error;
    }
    throw new InitSetupError(
      "scaffold-write",
      [
        "Sapporta init failed while preparing the staged project.",
        `Staging directory: ${stagingRoot}`,
        `Requested target was left untouched: ${project.root}`,
        `Retry the full \`sapporta init ${project.name}\` command after fixing the failure.`,
        `Cause: ${errorMessage(error)}`,
      ].join("\n"),
    );
  }

  return { dir: project.root, name: project.name };
}

function assertCanCreateProject(project: ScaffoldProject): void {
  const parentDir = dirname(project.root);
  if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
    throw new OperationError(
      `Cannot create ${project.root}: parent directory does not exist.`,
      ErrorCode.INIT_TARGET_EXISTS,
    );
  }

  if (existsSync(project.root)) {
    throw new OperationError(
      `Cannot create ${project.root}: the target path already exists. Remove it or choose a different project name, then retry \`sapporta init ${project.name}\`.`,
      ErrorCode.INIT_TARGET_EXISTS,
    );
  }
}

function assertPnpmAvailable(runCommand: InitCommandRunner): void {
  // pnpm is a hard requirement - the scaffold writes a pnpm-workspace.yaml
  // and root scripts that invoke `pnpm --filter ./packages/frontend`, neither of
  // which npm understands. Fail fast before touching the filesystem so the
  // user gets a clear error instead of a half-scaffolded directory.
  try {
    runCommand("pnpm", ["--version"], { stdio: "ignore" });
  } catch (error) {
    throw new OperationError(
      [
        "pnpm is required to scaffold a Sapporta project.",
        "The generated app uses a pnpm workspace.",
        "Install pnpm from https://pnpm.io/installation and retry the full `sapporta init` command.",
        `Cause: ${errorMessage(error)}`,
      ].join("\n"),
      ErrorCode.INIT_SETUP_FAILED,
    );
  }
}

function makeStagingRoot(projectRoot: string): string {
  return join(
    dirname(projectRoot),
    `.${projectRoot.split(/[\\/]/).at(-1) ?? "sapporta-project"}.sapporta-init-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
}

function writeProjectMarker(project: ScaffoldProject): void {
  const { dataDir, markerPath } = fromProjectRoot(project.root);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify({ name: project.name }, null, 2) + "\n",
  );
}

function publishStagingDirectory(
  stagingRoot: string,
  project: ScaffoldProject,
): void {
  if (existsSync(project.root)) {
    throw new OperationError(
      `Cannot publish ${project.root}: the target path appeared while Sapporta init was running. Remove it or choose a different project name, then retry \`sapporta init ${project.name}\`.`,
      ErrorCode.INIT_TARGET_EXISTS,
    );
  }
  runSetupStep({
    step: "atomic-publish",
    command: `rename ${stagingRoot} to ${project.root}`,
    project,
    stagingRoot,
    action: () => renameSync(stagingRoot, project.root),
  });
}

function runSetupStep(opts: {
  step: InitSetupStep;
  command: string;
  project: ScaffoldProject;
  stagingRoot: string;
  action: () => void;
}): void {
  try {
    opts.action();
  } catch (error) {
    if (error instanceof OperationError) {
      throw error;
    }
    throw new InitSetupError(
      opts.step,
      [
        `Sapporta init failed during ${formatStep(opts.step)}.`,
        `Command: ${opts.command}`,
        `Staging directory: ${opts.stagingRoot}`,
        `Requested target was left untouched: ${opts.project.root}`,
        `Retry the full \`sapporta init ${opts.project.name}\` command after fixing the failure.`,
        `Cause: ${errorMessage(error)}`,
      ].join("\n"),
    );
  }
}

function formatStep(step: InitSetupStep): string {
  switch (step) {
    case "npm-registry-preflight":
      return "the npm registry preflight";
    case "scaffold-write":
      return "project scaffold writing";
    case "pnpm-install":
      return "dependency installation";
    case "sqlite-native-bindings":
      return "SQLite native binding verification";
    case "migration-generate":
      return "initial migration generation";
    case "migration-apply":
      return "initial migration application";
    case "atomic-publish":
      return "project directory publication";
  }
}

function createScaffoldDirectories(project: ScaffoldProject): void {
  const { dataDir } = fromProjectRoot(project.root);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(project.root, "scripts"), { recursive: true });
  mkdirSync(project.apiDir, { recursive: true });
  mkdirSync(join(project.apiDir, "app"), { recursive: true });
  mkdirSync(join(project.apiDir, "project-auth"), { recursive: true });
  mkdirSync(join(project.apiDir, "schema"), { recursive: true });
  mkdirSync(join(project.apiDir, "migrations"), { recursive: true });
  mkdirSync(join(project.frontendDir, "src"), { recursive: true });
  mkdirSync(join(project.sharedDir, "src", "contracts"), { recursive: true });
}

function writeScaffoldFiles(
  projectRoot: string,
  files: Array<{ dest: string; content: string }>,
): void {
  for (const file of files) {
    const targetPath = join(projectRoot, file.dest);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, file.content);
  }
}

function installWorkspace(
  projectRoot: string,
  project: ScaffoldProject,
  runCommand: InitCommandRunner,
  progress: ProgressLogger,
): void {
  // pnpm presence was verified at the top of this function, so this is
  // guaranteed to resolve. One pass installs the root workspace.
  logInitSection(progress, "Installing the generated workspace dependencies");
  const args = ["install"] as const;
  logInitDetail(
    progress,
    "Running pnpm install so the API, frontend, and shared packages can build",
  );
  runSetupStep({
    step: "pnpm-install",
    command: formatCommand("pnpm", args),
    project,
    stagingRoot: projectRoot,
    action: () =>
      runCommand("pnpm", args, { cwd: projectRoot, stdio: "inherit" }),
  });
}

function generateInitialMigration(
  projectRoot: string,
  project: ScaffoldProject,
  runCommand: InitCommandRunner,
  progress: ProgressLogger,
): void {
  logInitSection(progress, "Generating the initial auth database migration");
  const args = [
    "--filter",
    "./packages/api",
    "db:generate",
    "--name",
    "initial_auth",
  ] as const;
  logInitDetail(
    progress,
    "Running pnpm --filter ./packages/api db:generate --name initial_auth to create SQL from the generated API schema",
  );
  runSetupStep({
    step: "migration-generate",
    command: formatCommand("pnpm", args),
    project,
    stagingRoot: projectRoot,
    action: () =>
      runCommand("pnpm", args, { cwd: projectRoot, stdio: "inherit" }),
  });
}

function runInitialMigration(
  projectRoot: string,
  project: ScaffoldProject,
  runCommand: InitCommandRunner,
  progress: ProgressLogger,
): void {
  logInitSection(progress, "Applying the initial auth database migration");
  const args = ["--filter", "./packages/api", "db:migrate"] as const;
  logInitDetail(
    progress,
    "Running pnpm --filter ./packages/api db:migrate so the development SQLite database matches the generated schema",
  );
  runSetupStep({
    step: "migration-apply",
    command: formatCommand("pnpm", args),
    project,
    stagingRoot: projectRoot,
    action: () =>
      runCommand("pnpm", args, { cwd: projectRoot, stdio: "inherit" }),
  });
}
