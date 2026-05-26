import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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

export async function step<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
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
  process.stderr.write(`[e2e path] npm CLI install dir: ${project.parentDir}\n`);
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
  expect(existsSync(join(project.projectDir, "packages", "frontend"))).toBe(true);
  expect(existsSync(join(project.projectDir, "packages", "shared"))).toBe(true);

  if (assertions.strictTemplateChecks) {
    expect(existsSync(join(project.projectDir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(project.projectDir, ".dockerignore"))).toBe(true);
    expect(
      readFileSync(join(project.projectDir, "Dockerfile"), "utf-8"),
    ).toContain('CMD ["node", "packages/api/dist/boot.js"]');
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
      'import { table, timestamp } from "@sapporta/server/table";',
      'import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";',
      "",
      "export const tasks = table({",
      '  drizzle: sqliteTable("tasks", {',
      '    id: integer("id").primaryKey({ autoIncrement: true }),',
      '    title: text("title").notNull(),',
      '    status: text("status").notNull(),',
      '    priority: integer("priority").notNull(),',
      '    created_at: timestamp("created_at"),',
      '    updated_at: timestamp("updated_at"),',
      "  }),",
      "  meta: {",
      '    label: "Tasks",',
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

export async function rebuildBetterSqlite(project: E2eProject): Promise<void> {
  await step("pnpm rebuild better-sqlite3", () =>
    run("pnpm", ["rebuild", "better-sqlite3"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 60_000,
    }),
  );
}

export async function buildProject(project: E2eProject): Promise<void> {
  await step("pnpm build (shared + api + frontend)", () =>
    run("pnpm", ["build"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 120_000,
    }),
  );
}

export async function prepareDockerReleaseProject(
  project: E2eProject,
): Promise<void> {
  const specs = sapportaPackageVersionSpecs();
  rewritePackageJson(join(project.projectDir, "package.json"), specs);
  rewritePackageJson(
    join(project.projectDir, "packages", "api", "package.json"),
    specs,
  );
  rewritePackageJson(
    join(project.projectDir, "packages", "frontend", "package.json"),
    specs,
  );

  await step("pnpm install after Docker release dependency rewrite", () =>
    run("pnpm", ["install"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 120_000,
    }),
  );
}

export async function startBuiltServer(
  project: E2eProject,
): Promise<StartedServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];

  const serverProcess = await step("boot scaffolded server", async () => {
    const child = spawn("node", ["packages/api/dist/boot.js"], {
      cwd: project.projectDir,
      env: { ...project.env, PORT: String(port) },
      stdio: "pipe",
    });

    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    try {
      await waitForJson(`${baseUrl}/api/openapi.json`);
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

export async function assertProjectHttpApi(baseUrl: string): Promise<void> {
  const tables = await curlJson<TablesBody>(`${baseUrl}/api/meta/tables`);
  expect(tables.tables.map((table) => table.name)).toContain("tasks");

  const first = await curlJson<RowBody>(`${baseUrl}/api/tables/tasks`, {
    method: "POST",
    body: TASK_ONE,
  });
  expect(first.data).toMatchObject(TASK_ONE);
  expect(first.data.id).toBeGreaterThan(0);

  const second = await curlJson<RowBody>(`${baseUrl}/api/tables/tasks`, {
    method: "POST",
    body: TASK_TWO,
  });
  expect(second.data).toMatchObject(TASK_TWO);
  expect(second.data.id).toBeGreaterThan(0);

  const listed = await curlJson<RowsBody>(`${baseUrl}/api/tables/tasks`);
  expect(listed.data.map((row) => row.title)).toEqual(
    expect.arrayContaining([TASK_ONE.title, TASK_TWO.title]),
  );

  const found = await curlJson<RowBody>(
    `${baseUrl}/api/tables/tasks/${first.data.id}`,
  );
  expect(found.data).toMatchObject(TASK_ONE);

  const hello = await curlJson<{ message: string }>(`${baseUrl}/api/hello`);
  expect(hello.message).toBe(`Hello from ${PROJECT_NAME}`);
}

export async function assertFrontendRoutes(baseUrl: string): Promise<void> {
  const root = await curlText(`${baseUrl}/`);
  expect(root).toContain('<div id="root">');
  expect(root).toContain("/assets/");

  const tableRoute = await curlText(`${baseUrl}/tables/tasks`);
  expect(tableRoute).toContain('<div id="root">');
  expect(tableRoute).toContain("/assets/");
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
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const text = await curlText(url, opts);
  return JSON.parse(text) as T;
}

export async function curlText(
  url: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<string> {
  const args = ["-fsS"];
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
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
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

function sapportaPackageVersionSpecs(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SAPPORTA_PACKAGE_DIRS).map(([packageName, packageDir]) => {
      const packageJson = readPackageJson(
        join(MONOREPO_ROOT, "packages", packageDir, "package.json"),
      );
      if (!packageJson.version) {
        throw new Error(`${packageName} is missing a package.json version`);
      }
      return [packageName, `^${packageJson.version}`];
    }),
  );
}

function rewritePackageJson(
  packageJsonPath: string,
  sapportaSpecs: Record<string, string>,
): void {
  const packageJson = readPackageJson(packageJsonPath);
  rewriteDependencySet(packageJson.dependencies, sapportaSpecs);
  rewriteDependencySet(packageJson.devDependencies, sapportaSpecs);

  if (packageJson.pnpm?.overrides) {
    for (const packageName of Object.keys(sapportaSpecs)) {
      delete packageJson.pnpm.overrides[packageName];
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
