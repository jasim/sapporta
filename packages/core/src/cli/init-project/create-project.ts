import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { ensureBetterSqlite3Loads } from "./sqlite-native-repair.js";
import {
  logInitDetail,
  logInitSection,
  noopProgress,
  type ProgressLogger,
} from "./init-progress.js";
import {
  renderScaffoldFiles,
  resolveScaffoldPackages,
  resolveOwningPackage,
  scaffoldProjectFromOptions,
  type ScaffoldPackages,
} from "./render-scaffold.js";

export { resolveOwningPackage, resolveScaffoldPackages };
export type { ScaffoldPackages };

export interface CreateProjectOptions {
  /** Absolute path to the project root (containing sapporta.json). */
  dir: string;
  /** Project name for package.json. Defaults to the directory basename. */
  name?: string;
  /** Optional hook for CLI progress messages while long-running setup runs. */
  progress?: ProgressLogger;
}

export interface CreateProjectResult {
  dir: string;
  name: string;
}

/**
 * Create a Sapporta code project: writes workspace package files, boot.ts,
 * app.ts, package.json, tsconfig.json from templates and installs dependencies.
 *
 * `dir` is the project root (containing sapporta.json). Backend code lives in
 * packages/api, with packages/frontend and packages/shared beside it.
 *
 * This is the SDK function - no CLI arg parsing, no OperationResult wrapping.
 *
 * Throws if package.json already exists in the target directory.
 */
export function createProject(opts: CreateProjectOptions): CreateProjectResult {
  const progress = opts.progress ?? noopProgress;
  const project = scaffoldProjectFromOptions(opts);

  logInitSection(progress, "Preparing the generated workspace scaffold");
  assertCanCreateProject(project);
  logInitDetail(progress, "Checking pnpm is available for workspace installs");
  assertPnpmAvailable();

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
    "Creating packages/api, packages/frontend, packages/shared, and support directories",
  );
  createScaffoldDirectories(project);
  logInitDetail(
    progress,
    "Writing TypeScript, Vite, Drizzle, auth, and package configuration files",
  );
  writeScaffoldFiles(project.root, files);

  installWorkspace(project.root, progress);
  logInitSection(progress, "Verifying SQLite native bindings");
  ensureBetterSqlite3Loads(project.apiDir, (message) =>
    logInitDetail(progress, message),
  );
  generateInitialMigration(project.root, progress);
  runInitialMigration(project.root, progress);

  return { dir: project.root, name: project.name };
}

function assertCanCreateProject(project: {
  packageJsonPath: string;
  root: string;
}): void {
  if (existsSync(project.packageJsonPath)) {
    throw new Error(`package.json already exists in ${project.root}`);
  }
}

function assertPnpmAvailable(): void {
  // pnpm is a hard requirement - the scaffold writes a pnpm-workspace.yaml
  // and root scripts that invoke `pnpm --filter ./packages/frontend`, neither of
  // which npm understands. Fail fast before touching the filesystem so the
  // user gets a clear error instead of a half-scaffolded directory.
  try {
    execSync("pnpm --version", { stdio: "ignore" });
  } catch {
    throw new Error(
      "pnpm is required to scaffold a Sapporta project (the scaffold uses a pnpm workspace). Install it from https://pnpm.io/installation and re-run `sapporta init`.",
    );
  }
}

function createScaffoldDirectories(project: {
  root: string;
  apiDir: string;
  frontendDir: string;
  sharedDir: string;
}): void {
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

function installWorkspace(projectRoot: string, progress: ProgressLogger): void {
  // pnpm presence was verified at the top of this function, so this is
  // guaranteed to resolve. One pass installs the root workspace.
  logInitSection(progress, "Installing the generated workspace dependencies");
  logInitDetail(
    progress,
    "Running pnpm install so the API, frontend, and shared packages can build",
  );
  execSync("pnpm install", { cwd: projectRoot, stdio: "inherit" });
}

function generateInitialMigration(
  projectRoot: string,
  progress: ProgressLogger,
): void {
  logInitSection(progress, "Generating the initial auth database migration");
  logInitDetail(
    progress,
    "Running pnpm --filter ./packages/api db:generate --name initial_auth to create SQL from the generated API schema",
  );
  execSync("pnpm --filter ./packages/api db:generate --name initial_auth", {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

function runInitialMigration(
  projectRoot: string,
  progress: ProgressLogger,
): void {
  logInitSection(progress, "Applying the initial auth database migration");
  logInitDetail(
    progress,
    "Running pnpm --filter ./packages/api db:migrate so the development SQLite database matches the generated schema",
  );
  execSync("pnpm --filter ./packages/api db:migrate", {
    cwd: projectRoot,
    stdio: "inherit",
  });
}
