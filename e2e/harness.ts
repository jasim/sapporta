import { spawn, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { expect } from "vitest";

export const MONOREPO_ROOT = join(import.meta.dirname, "..");
export const PROJECT_NAME = "test-project";
export const TASK_ONE = {
  title: "Write tests",
  status: "todo",
  priority: 2,
} as const;
export const TASK_TWO = {
  title: "Ship grid",
  status: "in_progress",
  priority: 1,
} as const;

export type E2eProject = {
  parentDir: string;
  projectDir: string;
  env: NodeJS.ProcessEnv;
};

export type TempProjectOptions = {
  devMode?: boolean;
  prefix?: string;
};

type ScaffoldAssertions = {
  strictTemplateChecks?: boolean;
};

export type CommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
};

export type StartedServer = {
  process: ChildProcess;
  baseUrl: string;
  output: string[];
};

export type StartedDockerProject = {
  baseUrl: string;
  containerId: string;
  imageTag: string;
};

export type TaskRow = {
  id: number;
  title: string;
  status: string;
  priority: number;
};

type TableSummary = {
  name: string;
};

type TablesBody = {
  tables: TableSummary[];
};

type RowBody = {
  data: TaskRow;
};

type RowsBody = {
  data: TaskRow[];
};

type AuthCookieOptions = {
  cookieFile?: string;
};

type SqliteTableColumn = {
  name: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const SAPPORTA_PACKAGE_DIRS = {
  "@sapporta/server": "core",
  "@sapporta/honest": "honest",
  "@sapporta/shared": "shared",
  "@sapporta/frontend": "frontend",
  "@sapporta/grid": "grid",
  "@sapporta/ui": "ui",
} as const;

export async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stderr.write(`[e2e setup] ${label}...\n`);
  const t0 = Date.now();
  const result = await fn();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[e2e setup] ${label} - ${secs}s\n`);
  return result;
}

export function createTempProject(opts: TempProjectOptions = {}): E2eProject {
  const parentDir = mkdtempSync(join(tmpdir(), opts.prefix ?? "sapporta-e2e-"));
  const projectDir = join(parentDir, PROJECT_NAME);
  const env = { ...process.env };
  env.BETTER_AUTH_SECRET = "sapporta-e2e-generated-project-secret";
  env.SAPPORTA_REQUIRE_VERIFIED_EMAIL = "false";
  if (opts.devMode ?? true) {
    env.SAPPORTA_DEV_MODE_PACKAGE_ROOT = MONOREPO_ROOT;
  } else {
    delete env.SAPPORTA_DEV_MODE_PACKAGE_ROOT;
  }
  process.stderr.write(`[e2e path] temp parent: ${parentDir}\n`);
  process.stderr.write(`[e2e path] project dir: ${projectDir}\n`);
  return {
    parentDir,
    projectDir,
    env,
  };
}

export function cleanupProject(project: E2eProject | undefined): void {
  if (!project) {
    return;
  }
  if (process.env.SAPPORTA_E2E_KEEP_TEMP === "1") {
    process.stderr.write(`[e2e cleanup] keeping ${project.parentDir}\n`);
    return;
  }
  rmSync(project.parentDir, { recursive: true, force: true });
}

export async function scaffoldProject(project: E2eProject): Promise<void> {
  await scaffoldProjectWithLocalCli(project);
}

export async function scaffoldProjectWithLocalCli(
  project: E2eProject,
): Promise<void> {
  await step("local sapporta init (scaffolds project + pnpm install)", () =>
    run(
      "node",
      [
        join(MONOREPO_ROOT, "packages/core/bin/sapporta.mjs"),
        "init",
        PROJECT_NAME,
      ],
      { cwd: project.parentDir, env: project.env, timeoutMs: 240_000 },
    ),
  );
  assertScaffoldedProject(project, { strictTemplateChecks: true });
}

export async function scaffoldProjectWithNpmCli(
  project: E2eProject,
): Promise<void> {
  process.stderr.write(
    `[e2e path] npm CLI install dir: ${project.parentDir}\n`,
  );
  await step("npm install sapporta", () =>
    run("npm", ["install", "sapporta"], {
      cwd: project.parentDir,
      env: project.env,
      timeoutMs: 180_000,
    }),
  );

  await step("npm sapporta init (scaffolds project + pnpm install)", () =>
    run(
      join(project.parentDir, "node_modules", ".bin", "sapporta"),
      ["init", PROJECT_NAME],
      { cwd: project.parentDir, env: project.env, timeoutMs: 240_000 },
    ),
  );
  assertScaffoldedProject(project, { strictTemplateChecks: false });
}

function assertScaffoldedProject(
  project: E2eProject,
  assertions: ScaffoldAssertions,
): void {
  expect(existsSync(join(project.projectDir, "package.json"))).toBe(true);
  expect(existsSync(join(project.projectDir, "packages", "api"))).toBe(true);
  expect(existsSync(join(project.projectDir, "packages", "frontend"))).toBe(
    true,
  );
  expect(existsSync(join(project.projectDir, "packages", "shared"))).toBe(true);

  if (assertions.strictTemplateChecks) {
    expect(existsSync(join(project.projectDir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(project.projectDir, ".dockerignore"))).toBe(true);
    expect(
      readFileSync(join(project.projectDir, "Dockerfile"), "utf-8"),
    ).toContain(
      'CMD ["sh", "-c", "pnpm --filter ./packages/api db:migrate && node packages/api/dist/boot.js"]',
    );
    expect(
      readPackageJson(join(project.projectDir, "package.json")),
    ).toMatchObject({
      packageManager: "pnpm@11.1.1",
    });
    const apiTsconfig = readFileSync(
      join(project.projectDir, "packages", "api", "tsconfig.json"),
      "utf-8",
    );
    expect(apiTsconfig).toContain(
      '"test-project-shared": ["../shared/dist/index.d.ts"]',
    );
    expect(apiTsconfig).not.toContain("../shared/src/index.ts");
  }
}

export function writeTasksSchema(projectDir: string): void {
  mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
  writeFileSync(
    join(projectDir, "packages", "api", "schema", "tasks.ts"),
    [
      'import { table, timestamp, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: text("status").notNull(),',
      '  priority: integer("priority").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  created_at: timestamp("created_at"),',
      '  updated_at: timestamp("updated_at"),',
      "});",
      "",
      "export const tasks = table({",
      "  drizzle: tasksTable,",
      "  meta: {",
      '    label: "Tasks",',
      '    rowScope: "workspaceGlobal",',
      "    selects: [",
      '      { type: "select", column: "status", options: ["todo", "in_progress", "done"] },',
      "    ],",
      "  },",
      "});",
      "",
      "export default tasks;",
      "",
    ].join("\n"),
  );
}

export function writeAuthScopedTasksSchema(projectDir: string): void {
  mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
  writeFileSync(
    join(projectDir, "packages", "api", "schema", "tasks.ts"),
    [
      'import { table, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: text("status").notNull(),',
      '  priority: integer("priority").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "",
      "export const tasks = table({",
      "  drizzle: tasksTable,",
      "  meta: {",
      '    label: "Tasks",',
      '    rowScope: "workspaceGlobal",',
      "    selects: [",
      '      { type: "select", column: "status", options: ["todo", "in_progress", "done"] },',
      "    ],",
      "  },",
      "});",
      "",
      "export default tasks;",
      "",
    ].join("\n"),
  );
}

export function writeProjectsSchema(projectDir: string): void {
  mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
  writeFileSync(
    join(projectDir, "packages", "api", "schema", "projects.ts"),
    [
      'import { table, timestamp, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const projectsTable = sqliteTable("projects", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      '  status: text("status").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  created_at: timestamp("created_at"),',
      '  updated_at: timestamp("updated_at"),',
      "});",
      "",
      "export const projects = table({",
      "  drizzle: projectsTable,",
      "  meta: {",
      '    label: "Projects",',
      '    rowScope: "workspaceGlobal",',
      "    selects: [",
      '      { type: "select", column: "status", options: ["active", "paused", "done"] },',
      "    ],",
      "  },",
      "});",
      "",
      "export default projects;",
      "",
    ].join("\n"),
  );
}

export async function assertBetterSqliteLoads(
  project: E2eProject,
): Promise<void> {
  await step("verify better-sqlite3 native bindings", () =>
    run(
      "pnpm",
      [
        "--filter",
        "./packages/api",
        "exec",
        "node",
        "-e",
        'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.prepare("select 1").get(); db.close();',
      ],
      {
        cwd: project.projectDir,
        env: project.env,
        timeoutMs: 60_000,
      },
    ),
  );
}

export async function buildProject(
  project: E2eProject,
  migrationName: string,
): Promise<void> {
  await runDrizzleMigrationCycle(project, migrationName);
  await buildGeneratedProject(project);
}

export async function runDrizzleMigrationCycle(
  project: E2eProject,
  name: string,
): Promise<void> {
  await generateDrizzleMigration(project, name);
  await runDrizzleMigrations(project, name);
}

export async function generateDrizzleMigration(
  project: E2eProject,
  name: string,
): Promise<void> {
  await step(`generate Drizzle migration (${name})`, async () => {
    const before = listMigrationSqlFiles(project.projectDir);
    const output = await runText(
      "pnpm",
      ["--filter", "./packages/api", "db:generate", "--name", name],
      {
        cwd: project.projectDir,
        env: project.env,
        timeoutMs: 60_000,
      },
    );
    const after = listMigrationSqlFiles(project.projectDir);
    expect(output).not.toContain("Error [");
    expect(
      after.length,
      [
        `Expected db:generate --name ${name} to create a SQL migration file.`,
        "Output:",
        output,
      ].join("\n"),
    ).toBeGreaterThan(before.length);
  });
}

async function runDrizzleMigrations(
  project: E2eProject,
  name: string,
): Promise<void> {
  await step(`run Drizzle migration (${name})`, () =>
    run("pnpm", ["--filter", "./packages/api", "db:migrate"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 60_000,
    }),
  );
}

function listMigrationSqlFiles(projectDir: string): string[] {
  const migrationsDir = join(projectDir, "packages", "api", "migrations");
  if (!existsSync(migrationsDir)) {
    return [];
  }
  return readdirSync(migrationsDir).filter((entry) => entry.endsWith(".sql"));
}

export async function buildGeneratedProject(
  project: E2eProject,
): Promise<void> {
  await step("pnpm build (shared + api + frontend)", () =>
    run("pnpm", ["build"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 300_000,
    }),
  );
}

export async function assertSqliteTable(
  project: E2eProject,
  tableName: string,
  expectedColumns: string[],
): Promise<void> {
  const databasePath = join(project.projectDir, "data", "sqlite.db");
  const queryScript = [
    'import Database from "better-sqlite3";',
    `const db = new Database(${JSON.stringify(databasePath)}, { readonly: true });`,
    `const tableName = ${JSON.stringify(tableName)};`,
    'const table = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", tableName);',
    'const columns = db.prepare("SELECT name FROM pragma_table_info(?)").all(tableName);',
    "db.close();",
    "console.log(JSON.stringify({ exists: Boolean(table), columns }));",
  ].join("\n");
  const output = await runText(
    "pnpm",
    [
      "--filter",
      "./packages/api",
      "exec",
      "node",
      "--input-type=module",
      "-e",
      queryScript,
    ],
    {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 30_000,
    },
  );
  const result = JSON.parse(output) as {
    exists: boolean;
    columns: SqliteTableColumn[];
  };
  expect(result.exists, `Expected SQLite table ${tableName} to exist`).toBe(
    true,
  );
  expect(result.columns.map((column) => column.name)).toEqual(
    expect.arrayContaining(expectedColumns),
  );
}

export async function prepareDockerReleaseProject(
  project: E2eProject,
): Promise<void> {
  // Exercise release-style installs without mixing current templates with
  // already-published Sapporta packages from npm.
  const specs = await packSapportaPackagesForProject(project);
  makeDockerfileCopyPackedSapportaPackages(project.projectDir);
  rewritePackageJson(join(project.projectDir, "package.json"), specs.root);
  rewritePackageJson(
    join(project.projectDir, "packages", "api", "package.json"),
    specs.workspacePackage,
  );
  rewritePackageJson(
    join(project.projectDir, "packages", "frontend", "package.json"),
    specs.workspacePackage,
  );

  await step("pnpm install after Docker release dependency rewrite", () =>
    run("pnpm", ["install"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 120_000,
    }),
  );
}

type PackedSapportaSpecs = {
  root: Record<string, string>;
  workspacePackage: Record<string, string>;
};

async function packSapportaPackagesForProject(
  project: E2eProject,
): Promise<PackedSapportaSpecs> {
  // Pack every local Sapporta package into the generated project so Docker
  // installs artifacts from this checkout, not stale registry versions.
  const tempPackDir = mkdtempSync(join(tmpdir(), "sapporta-e2e-pack-"));
  const projectPackDir = join(project.projectDir, ".sapporta-packages");
  mkdirSync(projectPackDir, { recursive: true });

  const entries: Array<readonly [string, string]> = [];
  for (const packageName of Object.keys(SAPPORTA_PACKAGE_DIRS)) {
    const before = new Set(readdirSync(tempPackDir));
    await step(`pack ${packageName}`, () =>
      run(
        "pnpm",
        ["--filter", packageName, "pack", "--pack-destination", tempPackDir],
        {
          cwd: MONOREPO_ROOT,
          env: project.env,
          timeoutMs: 60_000,
        },
      ),
    );
    const created = readdirSync(tempPackDir).filter(
      (entry) => entry.endsWith(".tgz") && !before.has(entry),
    );
    if (created.length !== 1) {
      throw new Error(
        `Expected pnpm pack for ${packageName} to create one tarball, got ${created.length}`,
      );
    }
    const tarball = created[0]!;
    copyFileSync(join(tempPackDir, tarball), join(projectPackDir, tarball));
    entries.push([packageName, tarball]);
  }

  rmSync(tempPackDir, { recursive: true, force: true });

  return {
    root: Object.fromEntries(
      entries.map(([packageName, tarball]) => [
        packageName,
        `file:.sapporta-packages/${tarball}`,
      ]),
    ),
    workspacePackage: Object.fromEntries(
      entries.map(([packageName, tarball]) => [
        packageName,
        `file:../../.sapporta-packages/${tarball}`,
      ]),
    ),
  };
}

function makeDockerfileCopyPackedSapportaPackages(projectDir: string): void {
  // Local-source Docker E2E is a release-candidate test: it scaffolds from this
  // checkout, then installs packed tarballs from this checkout inside Docker.
  // The shipped Dockerfile normally installs from package manifests before it
  // copies the full source tree, so those tarballs are not visible unless this
  // test patches the generated Dockerfile.
  //
  // The patch is test-only and deliberately anchored to exact Dockerfile lines:
  // if the template changes, fail here with context instead of silently building
  // an image that falls back to registry packages or misses runtime files.
  const dockerfilePath = join(projectDir, "Dockerfile");
  let dockerfile = readFileSync(dockerfilePath, "utf-8");
  const installStageManifestCopy =
    "COPY packages/shared/package.json packages/shared/package.json\n";
  const installStageManifestCopyWithTarballs =
    installStageManifestCopy + "COPY .sapporta-packages .sapporta-packages\n";
  const runtimeProjectFilesCopy =
    "COPY --chown=node:node sapporta.json package.json pnpm-workspace.yaml ./\n";
  const runtimeProjectFilesCopyWithTarballs =
    runtimeProjectFilesCopy +
    "COPY --chown=node:node .sapporta-packages ./.sapporta-packages\n";
  const runtimeApiPackageCopy =
    "COPY --from=build --chown=node:node /app/packages/api/package.json ./packages/api/package.json\n";
  const runtimeApiPackageCopyWithDrizzleConfig =
    runtimeApiPackageCopy +
    "COPY --from=build --chown=node:node /app/packages/api/drizzle.config.ts ./packages/api/drizzle.config.ts\n";
  const defaultRuntimeCommand =
    'CMD ["sh", "-c", "pnpm --filter ./packages/api db:migrate && node packages/api/dist/boot.js"]';

  // Avoid runtime `pnpm --filter`: with file: tarballs it may reinstall in a
  // non-TTY container. The package-local bin uses the installed artifact.
  const packedArtifactRuntimeCommand =
    'CMD ["sh", "-c", "cd packages/api && ./node_modules/.bin/drizzle-kit migrate && node dist/boot.js"]';

  dockerfile = replaceAllRequired(
    dockerfile,
    installStageManifestCopy,
    installStageManifestCopyWithTarballs,
    {
      label: "install-stage package manifest copy",
      expectedCount: 2,
      dockerfilePath,
    },
  );
  dockerfile = replaceRequired(
    dockerfile,
    runtimeProjectFilesCopy,
    runtimeProjectFilesCopyWithTarballs,
    {
      label: "runtime project metadata copy",
      dockerfilePath,
    },
  );
  dockerfile = replaceRequired(
    dockerfile,
    runtimeApiPackageCopy,
    runtimeApiPackageCopyWithDrizzleConfig,
    {
      label: "runtime API package copy",
      dockerfilePath,
    },
  );
  dockerfile = replaceRequired(
    dockerfile,
    defaultRuntimeCommand,
    packedArtifactRuntimeCommand,
    {
      label: "runtime command",
      dockerfilePath,
    },
  );

  writeFileSync(dockerfilePath, dockerfile);
}

type DockerfileReplacementContext = {
  label: string;
  dockerfilePath: string;
  expectedCount?: number;
};

function replaceRequired(
  text: string,
  marker: string,
  replacement: string,
  context: DockerfileReplacementContext,
): string {
  return replaceAllRequired(text, marker, replacement, {
    ...context,
    expectedCount: 1,
  });
}

function replaceAllRequired(
  text: string,
  marker: string,
  replacement: string,
  context: DockerfileReplacementContext,
): string {
  const count = countOccurrences(text, marker);
  if (count === 0) {
    throw new Error(
      [
        `Could not patch generated Dockerfile: missing ${context.label}.`,
        `Dockerfile: ${context.dockerfilePath}`,
        "Expected exact marker:",
        marker.trimEnd(),
      ].join("\n"),
    );
  }
  if (context.expectedCount !== undefined && count !== context.expectedCount) {
    throw new Error(
      [
        `Could not patch generated Dockerfile: ${context.label} count changed.`,
        `Dockerfile: ${context.dockerfilePath}`,
        `Expected ${context.expectedCount}, found ${count}.`,
        "Marker:",
        marker.trimEnd(),
      ].join("\n"),
    );
  }
  return text.replaceAll(marker, replacement);
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = text.indexOf(needle, index);
    if (index === -1) {
      return count;
    }
    count += 1;
    index += needle.length;
  }
}

export async function startBuiltServer(
  project: E2eProject,
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<StartedServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];

  const serverProcess = await step("boot scaffolded server", async () => {
    const child = spawn("node", ["packages/api/dist/boot.js"], {
      cwd: project.projectDir,
      env: {
        ...project.env,
        ...envOverrides,
        BETTER_AUTH_URL: envOverrides.BETTER_AUTH_URL ?? baseUrl,
        PORT: String(port),
      },
      stdio: "pipe",
    });

    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    try {
      await waitForJson(`${baseUrl}/health`);
    } catch (err) {
      console.error("Server failed to start. Output:\n" + output.join(""));
      child.kill("SIGTERM");
      throw err;
    }

    return child;
  });

  return { process: serverProcess, baseUrl, output };
}

export function stopServer(server: StartedServer | undefined): void {
  server?.process.kill("SIGTERM");
}

export async function buildAndRunDockerProject(
  project: E2eProject,
  tagPrefix: string,
): Promise<StartedDockerProject> {
  const dockerfilePath = join(project.projectDir, "Dockerfile");
  expect(
    existsSync(dockerfilePath),
    `Generated project is missing Dockerfile at ${dockerfilePath}`,
  ).toBe(true);

  const imageTag = `${tagPrefix}:${Date.now()}`;
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await step("docker build generated project", () =>
    run("docker", ["build", "-t", imageTag, "."], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 300_000,
    }),
  );

  const containerId = (
    await step("docker run generated image", () =>
      runText(
        "docker",
        [
          "run",
          "-d",
          "-p",
          `127.0.0.1:${port}:3000`,
          "--name",
          `${tagPrefix}-${Date.now()}`,
          imageTag,
        ],
        {
          cwd: project.projectDir,
          env: project.env,
          timeoutMs: 30_000,
        },
      ),
    )
  ).trim();

  await waitForDockerServer(baseUrl);
  return { baseUrl, containerId, imageTag };
}

export async function cleanupDockerProject(
  project: E2eProject | undefined,
  dockerProject: StartedDockerProject | undefined,
): Promise<void> {
  if (!dockerProject) {
    return;
  }
  await run("docker", ["rm", "-f", dockerProject.containerId], {
    cwd: project?.projectDir ?? process.cwd(),
    env: project?.env ?? process.env,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  await run("docker", ["rmi", "-f", dockerProject.imageTag], {
    cwd: project?.projectDir ?? process.cwd(),
    env: project?.env ?? process.env,
    timeoutMs: 30_000,
  }).catch(() => undefined);
}

export async function assertProjectHttpApi(
  baseUrl: string,
  serverOutput: readonly string[] = [],
): Promise<void> {
  const cookieFile = await signInProjectOwner(baseUrl);
  const auth = { cookieFile };
  const tables = await withServerOutput(
    () => curlJson<TablesBody>(`${baseUrl}/api/meta/tables`, auth),
    serverOutput,
  );
  expect(tables.tables.map((table) => table.name)).toContain("tasks");

  const first = await curlJson<RowBody>(`${baseUrl}/api/tables/tasks`, {
    ...auth,
    method: "POST",
    body: TASK_ONE,
  });
  expect(first.data).toMatchObject(TASK_ONE);
  expect(first.data.id).toBeGreaterThan(0);

  const second = await curlJson<RowBody>(`${baseUrl}/api/tables/tasks`, {
    ...auth,
    method: "POST",
    body: TASK_TWO,
  });
  expect(second.data).toMatchObject(TASK_TWO);
  expect(second.data.id).toBeGreaterThan(0);

  const listed = await curlJson<RowsBody>(`${baseUrl}/api/tables/tasks`, auth);
  expect(listed.data.map((row) => row.title)).toEqual(
    expect.arrayContaining([TASK_ONE.title, TASK_TWO.title]),
  );

  const found = await curlJson<RowBody>(
    `${baseUrl}/api/tables/tasks/${first.data.id}`,
    auth,
  );
  expect(found.data).toMatchObject(TASK_ONE);

  const hello = await curlJson<{ message: string }>(
    `${baseUrl}/api/hello`,
    auth,
  );
  expect(hello.message).toBe(`Hello from ${PROJECT_NAME}`);
}

async function signInProjectOwner(baseUrl: string): Promise<string> {
  const cookieFile = join(
    tmpdir(),
    `sapporta-e2e-cookies-${Date.now()}-${Math.random()}.txt`,
  );
  const credentials = {
    name: "Init Owner",
    email: `owner-${Date.now()}@example.com`,
    password: "SapportaAuthE2ePassword1!",
  };
  await curlJson<unknown>(`${baseUrl}/api/auth/sign-up/email`, {
    cookieFile,
    method: "POST",
    body: credentials,
  });
  await curlJson<unknown>(`${baseUrl}/api/auth/sign-in/email`, {
    cookieFile,
    method: "POST",
    body: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  await curlJson<unknown>(`${baseUrl}/api/auth-context`, { cookieFile });
  return cookieFile;
}

async function withServerOutput<T>(
  fn: () => Promise<T>,
  serverOutput: readonly string[],
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (serverOutput.length === 0) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error([message, "Server output:", ...serverOutput].join("\n"));
  }
}

export async function assertFrontendRoutes(baseUrl: string): Promise<void> {
  const root = await curlText(`${baseUrl}/`);
  expect(root).toContain('<div id="root">');
  expect(root).toContain("/assets/");

  const tableRoute = await curlText(`${baseUrl}/tables/tasks`);
  expect(tableRoute).toContain('<div id="root">');
  expect(tableRoute).toContain("/assets/");

  const assetPath = root.match(/\/assets\/[^"]+\.js/)?.[0];
  if (!assetPath) {
    expect.fail("Expected the built index.html to reference a JS asset");
  }
  const assetHeaders = await curlHeaders(`${baseUrl}${assetPath}`);
  expect(assetHeaders).toContain(
    "cache-control: public, max-age=31536000, immutable",
  );

  const rootHeaders = await curlHeaders(`${baseUrl}/`);
  expect(rootHeaders).toContain("cache-control: no-cache");
}

export async function run(
  command: string,
  args: string[],
  opts: CommandOptions,
): Promise<void> {
  await runText(command, args, opts);
}

export async function runText(
  command: string,
  args: string[],
  opts: CommandOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const output = Buffer.concat(chunks).toString();
      reject(
        new Error(
          `\`${command} ${args.join(" ")}\` timed out after ${opts.timeoutMs}ms\n${output}`,
        ),
      );
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(
        new Error(
          `\`${command} ${args.join(" ")}\` exited with code ${code}${
            signal ? ` (signal ${signal})` : ""
          }\n${output}`,
        ),
      );
    });
  });
}

export async function curlJson<T>(
  url: string,
  opts: { method?: string; body?: unknown } & AuthCookieOptions = {},
): Promise<T> {
  const text = await curlText(url, opts);
  return JSON.parse(text) as T;
}

export async function curlText(
  url: string,
  opts: { method?: string; body?: unknown } & AuthCookieOptions = {},
): Promise<string> {
  const args = ["-fsS"];
  if (opts.cookieFile) {
    args.push("-b", opts.cookieFile, "-c", opts.cookieFile);
  }
  if (opts.method) {
    args.push("-X", opts.method);
  }
  if (opts.body !== undefined) {
    args.push("-H", "Content-Type: application/json");
    args.push("--data", JSON.stringify(opts.body));
  }
  args.push(url);
  return runText("curl", args, {
    cwd: MONOREPO_ROOT,
    env: process.env,
    timeoutMs: 30_000,
  });
}

export async function curlHeaders(url: string): Promise<string> {
  return (
    await runText("curl", ["-fsSI", url], {
      cwd: MONOREPO_ROOT,
      env: process.env,
      timeoutMs: 30_000,
    })
  ).toLowerCase();
}

async function waitForJson(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await curlJson<unknown>(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not get port")));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForDockerServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await assertFrontendRoutes(baseUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  expect.fail(`Docker server at ${baseUrl} did not become ready`);
}

function rewritePackageJson(
  packageJsonPath: string,
  sapportaSpecs: Record<string, string>,
): void {
  const packageJson = readPackageJson(packageJsonPath);
  rewriteDependencySet(packageJson.dependencies, sapportaSpecs);
  rewriteDependencySet(packageJson.devDependencies, sapportaSpecs);

  if (packageJson.pnpm?.overrides) {
    for (const [packageName, spec] of Object.entries(sapportaSpecs)) {
      packageJson.pnpm.overrides[packageName] = spec;
    }
  }

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
}

function rewriteDependencySet(
  dependencies: Record<string, string> | undefined,
  sapportaSpecs: Record<string, string>,
): void {
  if (!dependencies) {
    return;
  }
  for (const [packageName, spec] of Object.entries(sapportaSpecs)) {
    if (dependencies[packageName]?.startsWith("link:")) {
      dependencies[packageName] = spec;
    }
  }
}

function readPackageJson(packageJsonPath: string): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson;
}
