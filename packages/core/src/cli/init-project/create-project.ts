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
import { ensureBetterSqlite3Loads } from "./sqlite-native-repair.js";
import {
  errorMessage,
  formatCommand,
  logInitDetail,
  logInitSection,
  noopProgress,
  runInitCommand,
  InitSetupError,
  type InitCommandRunner,
  type InitSetupStep,
  type ProgressLogger,
} from "./init-shell.js";
import { assertNpmRegistryReachable } from "./npm-registry-preflight.js";
import {
  layoutForRoot,
  projectIdentityFromOptions,
  scaffoldDirectoriesFor,
  stagingRootFor,
  type ProjectLayout,
} from "./project-layout.js";
import { renderScaffoldFiles } from "./render-scaffold.js";

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
  const project = layoutForRoot(projectIdentityFromOptions(opts));

  logInitSection(progress, "Preparing the generated workspace scaffold");
  assertCanCreateProject(project);
  logInitDetail(progress, "Checking pnpm is available for workspace installs");
  assertPnpmAvailable(runCommand);

  logInitDetail(
    progress,
    "Checking npm registry access before resolving project package versions",
  );
  assertNpmRegistryReachable({
    targetRoot: project.root,
    runCommand,
    progress: (message) => logInitDetail(progress, message),
  });

  logInitDetail(
    progress,
    "Resolving Sapporta package versions for the new project's package.json files",
  );
  const files = renderScaffoldFiles(project, process.env.SAPPORTA_PACKAGE_ROOT);

  const stagingRoot = stagingRootFor(
    project.root,
    randomBytes(6).toString("hex"),
  );
  const stagedProject = layoutForRoot(
    projectIdentityFromOptions({
      dir: stagingRoot,
      name: project.name,
    }),
  );
  executeCreateProjectWorkflow({
    requestedProject: project,
    stagedProject,
    files,
    runCommand,
    verifySqlite,
    progress,
  });

  return { dir: project.root, name: project.name };
}

function assertCanCreateProject(project: ProjectLayout): void {
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

type CreateProjectSetupOptions = {
  requestedProject: ProjectLayout;
  stagedProject: ProjectLayout;
  files: ReturnType<typeof renderScaffoldFiles>;
  runCommand: InitCommandRunner;
  verifySqlite: (apiDir: string, progress: ProgressLogger) => void;
  progress: ProgressLogger;
};

function executeCreateProjectWorkflow(opts: CreateProjectSetupOptions): void {
  new CreateProjectSetup(opts).run();
}

class CreateProjectSetup {
  constructor(private readonly opts: CreateProjectSetupOptions) {}

  run(): void {
    try {
      this.writeWorkspaceFiles();
      this.installWorkspaceDependencies();
      this.verifySqliteNativeBindings();
      this.generateInitialAuthMigration();
      this.applyInitialAuthMigration();
      this.createInitialGitCommit();
      this.publishProjectDirectory();
    } catch (error) {
      this.removeStagingDirectory();
      if (error instanceof OperationError) {
        throw error;
      }
      throw new InitSetupError(
        "scaffold-write",
        [
          "Sapporta init failed while preparing the staged project.",
          `Staging directory: ${this.opts.stagedProject.root}`,
          `Requested target was left untouched: ${this.opts.requestedProject.root}`,
          `Retry the full \`sapporta init ${this.opts.requestedProject.name}\` command after fixing the failure.`,
          `Cause: ${errorMessage(error)}`,
        ].join("\n"),
      );
    }
  }

  private writeWorkspaceFiles(): void {
    this.logSection({
      title: "Creating the Sapporta project directory",
      details: [
        `Project directory: ${this.opts.requestedProject.root}`,
        `Staging directory: ${this.opts.stagedProject.root}`,
        "Creating packages/api, packages/frontend, packages/shared, and support directories",
        "Writing TypeScript, Vite, Drizzle, auth, and package configuration files",
      ],
    });

    this.runSetupStep({
      step: "scaffold-write",
      command: "write generated project files",
      action: () => {
        for (const directory of scaffoldDirectoriesFor(
          this.opts.stagedProject.root,
        )) {
          mkdirSync(directory, { recursive: true });
        }
        this.writeFileWithParents(
          this.opts.stagedProject.markerPath,
          `${JSON.stringify({ name: this.opts.requestedProject.name }, null, 2)}\n`,
        );
        for (const file of this.opts.files) {
          this.writeFileWithParents(
            join(this.opts.stagedProject.root, file.dest),
            file.content,
          );
        }
      },
    });
  }

  private installWorkspaceDependencies(): void {
    this.runCommandStep({
      step: "pnpm-install",
      title: "Installing the generated workspace dependencies",
      details: [
        "Running pnpm install so the API, frontend, and shared packages can build",
      ],
      command: "pnpm",
      args: ["install"],
    });
  }

  private verifySqliteNativeBindings(): void {
    this.logSection({
      title: "Verifying SQLite native bindings",
      details: [],
    });
    this.runSetupStep({
      step: "sqlite-native-bindings",
      command: "better-sqlite3 smoke test and repair",
      action: () =>
        this.opts.verifySqlite(this.opts.stagedProject.apiDir, (message) =>
          logInitDetail(this.opts.progress, message),
        ),
    });
  }

  private generateInitialAuthMigration(): void {
    this.runCommandStep({
      step: "migration-generate",
      title: "Generating the initial auth database migration",
      details: [
        "Running pnpm --filter ./packages/api db:generate --name initial_auth to create SQL from the generated API schema",
      ],
      command: "pnpm",
      args: [
        "--filter",
        "./packages/api",
        "db:generate",
        "--name",
        "initial_auth",
      ],
    });
  }

  private applyInitialAuthMigration(): void {
    this.runCommandStep({
      step: "migration-apply",
      title: "Applying the initial auth database migration",
      details: [
        "Running pnpm --filter ./packages/api db:migrate so the development SQLite database matches the generated schema",
      ],
      command: "pnpm",
      args: ["--filter", "./packages/api", "db:migrate"],
    });
  }

  private createInitialGitCommit(): void {
    this.runCommandStep({
      step: "git-init",
      title: "Initializing the project Git repository",
      details: [
        "Running git init so the generated project starts with version history",
      ],
      command: "git",
      args: ["init"],
    });
    this.runCommandStep({
      step: "git-add",
      title: "Staging the generated project files",
      details: ["Running git add . to stage the generated app files"],
      command: "git",
      args: ["add", "."],
    });
    this.runCommandStep({
      step: "git-commit",
      title: "Creating the initial project commit",
      details: [
        'Running git commit -m "Create Sapporta project" for the generated app',
      ],
      command: "git",
      args: ["commit", "-m", "Create Sapporta project"],
    });
  }

  private publishProjectDirectory(): void {
    this.logSection({
      title: "Publishing the generated project directory",
      details: [],
    });

    if (existsSync(this.opts.requestedProject.root)) {
      throw new OperationError(
        `Cannot publish ${this.opts.requestedProject.root}: the target path appeared while Sapporta init was running. Remove it or choose a different project name, then retry \`sapporta init ${this.opts.requestedProject.name}\`.`,
        ErrorCode.INIT_TARGET_EXISTS,
      );
    }

    this.runSetupStep({
      step: "atomic-publish",
      command: `rename ${this.opts.stagedProject.root} to ${this.opts.requestedProject.root}`,
      action: () =>
        renameSync(
          this.opts.stagedProject.root,
          this.opts.requestedProject.root,
        ),
    });
  }

  private runCommandStep(opts: {
    step: InitSetupStep;
    title: string;
    details: readonly string[];
    command: string;
    args: readonly string[];
  }): void {
    this.logSection({
      title: opts.title,
      details: opts.details,
    });
    this.runSetupStep({
      step: opts.step,
      command: formatCommand(opts.command, opts.args),
      action: () =>
        this.opts.runCommand(opts.command, opts.args, {
          cwd: this.opts.stagedProject.root,
          stdio: "inherit",
        }),
    });
  }

  private runSetupStep(opts: {
    step: InitSetupStep;
    command: string;
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
        this.formatSetupFailure({
          step: opts.step,
          command: opts.command,
          cause: errorMessage(error),
        }),
      );
    }
  }

  private logSection(opts: {
    title: string;
    details: readonly string[];
  }): void {
    logInitSection(this.opts.progress, opts.title);
    for (const detail of opts.details) {
      logInitDetail(this.opts.progress, detail);
    }
  }

  private writeFileWithParents(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  private removeStagingDirectory(): void {
    rmSync(this.opts.stagedProject.root, { recursive: true, force: true });
  }

  private formatSetupFailure(opts: {
    step: InitSetupStep;
    command: string;
    cause: string;
  }): string {
    return [
      `Sapporta init failed during ${formatStep(opts.step)}.`,
      `Command: ${opts.command}`,
      `Staging directory: ${this.opts.stagedProject.root}`,
      `Requested target was left untouched: ${this.opts.requestedProject.root}`,
      `Retry the full \`sapporta init ${this.opts.requestedProject.name}\` command after fixing the failure.`,
      `Cause: ${opts.cause}`,
    ].join("\n");
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
    case "git-init":
      return "Git repository initialization";
    case "git-add":
      return "initial Git staging";
    case "git-commit":
      return "initial Git commit";
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
