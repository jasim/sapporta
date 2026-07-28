import { randomUUID } from "node:crypto";
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

export type StartServerOptions = {
  env?: NodeJS.ProcessEnv;
  readyPath?: string;
};

export type BootFailure = {
  baseUrl: string;
  code: number | null;
  signal: string | null;
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

export type RequestHeaders = Record<string, string>;

export type JsonRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: RequestHeaders;
  origin?: string | null;
  cookieFile?: string;
  expectedStatus?: number | readonly number[];
  expectedSuccess?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  serverOutput?: readonly string[];
  timeoutMs?: number;
};

export type JsonResponse<T> = {
  status: number;
  body: T;
  rawBody: string;
  headers: RequestHeaders;
};

export type EmailUserCredentials = {
  email: string;
  password: string;
  name?: string;
  cookieFile?: string;
};

export type EmailAuthResult<T> = {
  requestBody: EmailUserCredentials;
  cookieFile: string;
  response: JsonResponse<T>;
};

export type SignOutResult<T> = {
  requestBody: Record<string, never>;
  cookieFile: string;
  response: JsonResponse<T>;
};

export type SignedInEmailUser = {
  email: string;
  password: string;
  cookieFile: string;
};

export type WorkspaceMemberRole = "owner" | "admin" | "member";

export type AuthContextBody = {
  user: { id: string; email: string; emailVerified: boolean };
  workspace: { id: string; name: string; slug: string; isOwner?: boolean };
  memberships: Array<{
    workspace: { id: string; name: string; slug: string };
    role: string;
    isOwner: boolean;
  }>;
  role?: string;
  isOwner?: boolean;
};

export type AuthContextExpectation = {
  email?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  role?: string;
  isOwner?: boolean;
};

export type SqliteValue = string | number | boolean | null;

export type SqliteStatementResult = {
  changes: number;
  lastInsertRowid: number | string;
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
  env.SAPPORTA_MAIL_FROM = "Sapporta <no-reply@example.test>";
  if (opts.devMode ?? true) {
    env.SAPPORTA_PACKAGE_ROOT = MONOREPO_ROOT;
  } else {
    delete env.SAPPORTA_PACKAGE_ROOT;
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
      'import { sapportaTable, timestamp, sqliteTable, text, select, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: select("status", ["todo", "in_progress", "done"]).notNull(),',
      '  priority: integer("priority").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  created_at: timestamp("created_at"),',
      '  updated_at: timestamp("updated_at"),',
      "});",
      "",
      "export const tasks = sapportaTable({",
      "  drizzle: tasksTable,",
      "  meta: {",
      '    label: "Tasks",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["title"],',
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
      'import { sapportaTable, sqliteTable, text, select, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: select("status", ["todo", "in_progress", "done"]).notNull(),',
      '  priority: integer("priority").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "",
      "export const tasks = sapportaTable({",
      "  drizzle: tasksTable,",
      "  meta: {",
      '    label: "Tasks",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["title"],',
      "  },",
      "});",
      "",
      "export default tasks;",
      "",
    ].join("\n"),
  );
}

export function writeAuthzCustomRouteFixtures(projectDir: string): void {
  const apiDir = join(projectDir, "packages", "api");
  const appDir = join(apiDir, "app");
  mkdirSync(appDir, { recursive: true });

  writeFileSync(
    join(appDir, "authz-public.ts"),
    [
      'import { z } from "zod";',
      'import { forbidUnless, initContract, TsRestApi, type SapportaEnv } from "@sapporta/server";',
      "",
      "const c = initContract();",
      "",
      "const authzPublicRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/public",',
      '  summary: "Read a public authz sample",',
      "  responses: {",
      "    200: z.object({",
      '      kind: z.enum(["anonymous", "user"]),',
      "      email: z.string().optional(),",
      "    }),",
      "  },",
      "});",
      "",
      "const authzDeniedPublicRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/public-denied",',
      '  summary: "Read a denied public authz sample",',
      "  responses: { 200: z.object({ ok: z.literal(true) }) },",
      "});",
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.register("authzPublic", authzPublicRoute, ({ c }) => {',
      '  const auth = c.get("auth");',
      '  forbidUnless(c, auth.ability.can("read", "authz_public"));',
      "  const principal = auth.principal;",
      "  return {",
      "    status: 200,",
      "    body:",
      '      principal.kind === "user"',
      '        ? { kind: "user" as const, email: principal.user.email }',
      '        : { kind: "anonymous" as const },',
      "  };",
      "});",
      "",
      'api.register("authzDeniedPublic", authzDeniedPublicRoute, ({ c }) => {',
      '  const auth = c.get("auth");',
      '  forbidUnless(c, auth.ability.can("read", "authz_denied_public"));',
      "  return { status: 200, body: { ok: true as const } };",
      "});",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(appDir, "authz-private.ts"),
    [
      'import { z } from "zod";',
      'import { forbidUnless, initContract, TsRestApi, type SapportaEnv } from "@sapporta/server";',
      'import { requirePrincipalUser } from "../project-auth/index.js";',
      "",
      "const c = initContract();",
      "",
      "const authzPrivateRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/private",',
      '  summary: "Read a signed-in authz sample",',
      "  responses: { 200: z.object({ email: z.string() }) },",
      "});",
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.register("authzPrivate", authzPrivateRoute, ({ c }) => {',
      '  const auth = c.get("auth");',
      "  const principal = requirePrincipalUser(c);",
      '  forbidUnless(c, auth.ability.can("read", "authz_private"));',
      "  return { status: 200, body: { email: principal.user.email } };",
      "});",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(appDir, "authz-workspace.ts"),
    [
      'import { z } from "zod";',
      'import { forbidUnless, initContract, TsRestApi, type SapportaEnv } from "@sapporta/server";',
      'import { requireWorkspaceRowsAllowed } from "../project-auth/index.js";',
      "",
      "const c = initContract();",
      "",
      "const authzWorkspaceRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/workspace",',
      '  summary: "Read a workspace authz sample",',
      "  responses: {",
      "    200: z.object({",
      "      workspaceId: z.string(),",
      '      role: z.enum(["owner", "member"]),',
      "    }),",
      "  },",
      "});",
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.register("authzWorkspace", authzWorkspaceRoute, ({ c }) => {',
      "  const auth = requireWorkspaceRowsAllowed(c);",
      '  forbidUnless(c, auth.ability.can("run", "authz_workspace"));',
      '  if (auth.principal.kind !== "user") {',
      '    throw new Error("Workspace user required.");',
      "  }",
      '  const role = auth.principal.membership.roles.includes("owner")',
      '    ? "owner" as const',
      '    : "member" as const;',
      "  return {",
      "    status: 200,",
      "    body: {",
      "      workspaceId:",
      "        auth.dataAuthority.rowAuthorities.workspaceGlobalOnly.workspace.id,",
      "      role,",
      "    },",
      "  };",
      "});",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(appDir, "authz-owner.ts"),
    [
      'import { z } from "zod";',
      'import { forbidUnless, initContract, TsRestApi, type SapportaEnv } from "@sapporta/server";',
      'import { requireWorkspaceOwner } from "../project-auth/index.js";',
      "",
      "const c = initContract();",
      "",
      "const authzOwnerRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/owner",',
      '  summary: "Read an owner authz sample",',
      "  responses: { 200: z.object({ workspaceId: z.string() }) },",
      "});",
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.register("authzOwner", authzOwnerRoute, ({ c }) => {',
      "  const auth = requireWorkspaceOwner(c);",
      '  forbidUnless(c, auth.ability.can("run", "authz_owner"));',
      "  return {",
      "    status: 200,",
      "    body: {",
      "      workspaceId:",
      "        auth.dataAuthority.rowAuthorities.workspaceGlobalOnly.workspace.id,",
      "    },",
      "  };",
      "});",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(appDir, "authz-custom-table.ts"),
    [
      'import { eq } from "drizzle-orm";',
      'import { z } from "zod";',
      "import {",
      "  ApiWritePolicyError,",
      "  forbidUnless,",
      "  initContract,",
      "  TsRestApi,",
      "  ValidationError,",
      "  type SapportaEnv,",
      '} from "@sapporta/server";',
      'import { requireWorkspaceOwner } from "../project-auth/index.js";',
      'import { tasks, tasksTable } from "../schema/auth_matrix.js";',
      "",
      "const c = initContract();",
      "",
      "const taskRowSchema = z.object({",
      "  id: z.number(),",
      "  title: z.string(),",
      "  status: z.string(),",
      "  priority: z.number(),",
      "  workspace_id: z.string(),",
      "});",
      "",
      "const taskInputSchema = z.object({",
      "  title: z.string().min(1),",
      '  status: z.enum(["todo", "in_progress", "done"]),',
      "  priority: z.number().int(),",
      "  workspace_id: z.string().optional(),",
      "});",
      "",
      "const taskPatchSchema = z.object({",
      "  title: z.string().min(1).optional(),",
      '  status: z.enum(["todo", "in_progress", "done"]).optional(),',
      "  priority: z.number().int().optional(),",
      "  workspace_id: z.string().optional(),",
      "});",
      "",
      "const errorSchema = z.object({",
      "  error: z.string(),",
      "  code: z.string().optional(),",
      "  details: z.array(z.unknown()).optional(),",
      "});",
      "",
      "const listTasksRoute = c.query({",
      '  method: "GET",',
      '  path: "/authz/custom-tasks",',
      '  summary: "List visible custom task rows",',
      "  responses: { 200: z.object({ data: z.array(taskRowSchema) }) },",
      "});",
      "",
      "const createTaskRoute = c.mutation({",
      '  method: "POST",',
      '  path: "/authz/custom-tasks",',
      '  summary: "Create a custom task row",',
      "  body: taskInputSchema,",
      "  responses: { 200: z.object({ data: taskRowSchema }), 422: errorSchema },",
      "});",
      "",
      "const updateTaskRoute = c.mutation({",
      '  method: "PATCH",',
      '  path: "/authz/custom-tasks/:id",',
      '  summary: "Update a visible custom task row",',
      "  pathParams: z.object({ id: z.coerce.number().int().positive() }),",
      "  body: taskPatchSchema,",
      "  responses: {",
      "    200: z.object({ data: taskRowSchema }),",
      "    404: errorSchema,",
      "    422: errorSchema,",
      "  },",
      "});",
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.register("authzListCustomTasks", listTasksRoute, async ({ c }) => {',
      "  const auth = requireWorkspaceOwner(c);",
      '  forbidUnless(c, auth.ability.can("run", "authz_custom_tasks"));',
      "  const access = auth.rowSecurity.forTable(tasks);",
      '  const db = c.get("db");',
      "  const rows = await db",
      "    .select()",
      "    .from(tasksTable)",
      "    .where(access.ownedRows())",
      "    .orderBy(tasksTable.id);",
      "  return { status: 200, body: { data: rows } };",
      "});",
      "",
      'api.register("authzCreateCustomTask", createTaskRoute, async ({ c, request }) => {',
      "  const auth = requireWorkspaceOwner(c);",
      '  forbidUnless(c, auth.ability.can("run", "authz_custom_tasks"));',
      '  const db = c.get("db");',
      "  try {",
      "    const input = (await auth.rowSecurity",
      "      .forTable(tasks)",
      "      .insertValues(db, request.body)) as typeof tasksTable.$inferInsert;",
      "    const rows = await db.insert(tasksTable).values(input).returning();",
      "    return { status: 200, body: { data: rows[0]! } };",
      "  } catch (err) {",
      "    return validationError(err);",
      "  }",
      "});",
      "",
      'api.register("authzUpdateCustomTask", updateTaskRoute, async ({ c, request }) => {',
      "  const auth = requireWorkspaceOwner(c);",
      '  forbidUnless(c, auth.ability.can("run", "authz_custom_tasks"));',
      '  const db = c.get("db");',
      "  const access = auth.rowSecurity.forTable(tasks);",
      "  try {",
      "    const patch = (await access.patchValues(",
      "      db,",
      "      request.body,",
      "    )) as Partial<typeof tasksTable.$inferInsert>;",
      "    const rows = await db",
      "      .update(tasksTable)",
      "      .set(patch)",
      "      .where(access.ownedRows(eq(tasksTable.id, request.params.id)))",
      "      .returning();",
      "    if (!rows[0]) {",
      '      return { status: 404, body: { error: "Not found", code: "not_found" } };',
      "    }",
      "    return { status: 200, body: { data: rows[0] } };",
      "  } catch (err) {",
      "    return validationError(err);",
      "  }",
      "});",
      "",
      "function validationError(err: unknown) {",
      "  if (err instanceof ApiWritePolicyError) {",
      "    return {",
      "      status: 422 as const,",
      "      body: {",
      '        error: "Validation failed",',
      '        code: "validation_failed",',
      "        details: [...err.errors],",
      "      },",
      "    };",
      "  }",
      "  if (err instanceof ValidationError) {",
      "    return {",
      "      status: 422 as const,",
      "      body: {",
      '        error: "Validation failed",',
      '        code: "validation_failed",',
      "        details: err.errors,",
      "      },",
      "    };",
      "  }",
      "  throw err;",
      "}",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );

  const appPath = join(apiDir, "app.ts");
  const appSource = readFileSync(appPath, "utf-8")
    .replace(
      'import helloApi from "./app/hello.js";\nimport publicApiSample from "./app/public-api-sample.js";',
      [
        'import helloApi from "./app/hello.js";',
        'import publicApiSample from "./app/public-api-sample.js";',
        'import authzPublicApi from "./app/authz-public.js";',
        'import authzPrivateApi from "./app/authz-private.js";',
        'import authzWorkspaceApi from "./app/authz-workspace.js";',
        'import authzOwnerApi from "./app/authz-owner.js";',
        'import authzCustomTableApi from "./app/authz-custom-table.js";',
      ].join("\n"),
    )
    .replace(
      '  app.route("/", helloApi);\n  app.route("/", publicApiSample);',
      [
        '  app.route("/", helloApi);',
        '  app.route("/", publicApiSample);',
        '  app.route("/", authzPublicApi);',
        '  app.route("/", authzPrivateApi);',
        '  app.route("/", authzWorkspaceApi);',
        '  app.route("/", authzOwnerApi);',
        '  app.route("/", authzCustomTableApi);',
      ].join("\n"),
    )
    .replace(
      '  { method: "GET", path: "/api/public-api-sample" },',
      [
        '  { method: "GET", path: "/api/public-api-sample" },',
        '  { method: "GET", path: "/api/authz/public" },',
        '  { method: "GET", path: "/api/authz/public-denied" },',
      ].join("\n"),
    );
  writeFileSync(appPath, appSource);

  const abilityPath = join(apiDir, "authz", "ability.ts");
  const abilitySource = readFileSync(abilityPath, "utf-8")
    .replace(
      '  can("read", "public_api_sample");',
      '  can("read", "public_api_sample");\n  can("read", "authz_public");',
    )
    .replace(
      '    can("read", "hello");',
      [
        '    can("read", "hello");',
        '    can("read", "authz_private");',
        '    can("run", "authz_workspace");',
      ].join("\n"),
    )
    .replace(
      '    can("manage", "all");',
      [
        '    can("manage", "all");',
        '    can("run", "authz_owner");',
        '    can("run", "authz_custom_tasks");',
      ].join("\n"),
    );
  writeFileSync(abilityPath, abilitySource);
}

export function writeAuthMatrixSchema(projectDir: string): void {
  mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
  writeFileSync(
    join(projectDir, "packages", "api", "schema", "auth_matrix.ts"),
    [
      'import { sapportaTable, sqliteTable, text, select, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: select("status", ["todo", "in_progress", "done"]).notNull(),',
      '  priority: integer("priority").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "",
      "export const tasks = sapportaTable({",
      "  drizzle: tasksTable,",
      "  meta: {",
      '    label: "Tasks",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["title"],',
      '    search: { columns: ["title", "status"] },',
      "  },",
      "});",
      "",
      'export const notesTable = sqliteTable("notes", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  body: text("body").notNull(),',
      '  category: select("category", ["personal", "shared", "archive"]).notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  scoped_to_user_id: text("scoped_to_user_id").notNull(),',
      "});",
      "",
      "export const notes = sapportaTable({",
      "  drizzle: notesTable,",
      "  meta: {",
      '    label: "Notes",',
      '    rowScope: "workspaceUserScoped",',
      '    rowLabelColumns: ["title"],',
      '    search: { columns: ["title", "body", "category"] },',
      "  },",
      "});",
      "",
      'export const countriesTable = sqliteTable("countries", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  code: text("code").notNull(),',
      '  name: text("name").notNull(),',
      "});",
      "",
      "export const countries = sapportaTable({",
      "  drizzle: countriesTable,",
      "  meta: {",
      '    label: "Countries",',
      "    immutable: true,",
      '    rowScope: "systemGlobal",',
      '    rowLabelColumns: ["name"],',
      '    search: { columns: ["code", "name"] },',
      "  },",
      "});",
      "",
      'export const customersTable = sqliteTable("customers", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      '  tier: select("tier", ["standard", "priority"]).notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "",
      "export const customers = sapportaTable({",
      "  drizzle: customersTable,",
      "  meta: {",
      '    label: "Customers",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["name"],',
      '    search: { columns: ["name", "tier"] },',
      "  },",
      "});",
      "",
      'export const productsTable = sqliteTable("products", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  sku: text("sku").notNull(),',
      '  name: text("name").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "",
      "export const products = sapportaTable({",
      "  drizzle: productsTable,",
      "  meta: {",
      '    label: "Products",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["sku", "name"],',
      '    search: { columns: ["sku", "name"] },',
      "  },",
      "});",
      "",
      'export const invoicesTable = sqliteTable("invoices", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  invoice_number: text("invoice_number").notNull(),',
      '  status: select("status", ["draft", "sent", "paid"]).notNull(),',
      '  customer_id: integer("customer_id")',
      "    .notNull()",
      "    .references(() => customersTable.id),",
      '  workspace_id: text("workspace_id").notNull(),',
      '  scoped_to_user_id: text("scoped_to_user_id").notNull(),',
      "});",
      "",
      "export const invoices = sapportaTable({",
      "  drizzle: invoicesTable,",
      "  meta: {",
      '    label: "Invoices",',
      '    rowScope: "workspaceUserScoped",',
      '    rowLabelColumns: ["invoice_number"],',
      '    search: { columns: ["invoice_number"] },',
      '    references: { customer_id: { table: "customers", column: "id" } },',
      "    children: [",
      '      { table: "invoice_lines", foreignKey: "invoice_id", label: "Lines" },',
      "    ],",
      "  },",
      "});",
      "",
      'export const invoiceLinesTable = sqliteTable("invoice_lines", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  invoice_id: integer("invoice_id")',
      "    .notNull()",
      "    .references(() => invoicesTable.id),",
      '  product_id: integer("product_id")',
      "    .notNull()",
      "    .references(() => productsTable.id),",
      '  description: text("description").notNull(),',
      '  amount_cents: integer("amount_cents").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  scoped_to_user_id: text("scoped_to_user_id").notNull(),',
      "});",
      "",
      "export const invoiceLines = sapportaTable({",
      "  drizzle: invoiceLinesTable,",
      "  meta: {",
      '    label: "Invoice lines",',
      '    rowScope: "workspaceUserScoped",',
      '    rowLabelColumns: ["description"],',
      "    references: {",
      '      invoice_id: { table: "invoices", column: "id", apiSettable: false },',
      '      product_id: { table: "products", column: "id" },',
      "    },",
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

export function patchAuthMatrixAbility(projectDir: string): void {
  const abilityPath = join(
    projectDir,
    "packages",
    "api",
    "authz",
    "ability.ts",
  );
  writeFileSync(
    abilityPath,
    [
      'import { AbilityBuilder, createMongoAbility } from "@casl/ability";',
      'import type { AppAbility, AppAuthFacts } from "./types.js";',
      "",
      "const memberTables = [",
      '  "tasks",',
      '  "notes",',
      '  "customers",',
      '  "products",',
      '  "invoices",',
      '  "invoice_lines",',
      "] as const;",
      "",
      "const memberActions = [",
      '  "read",',
      '  "create",',
      '  "update",',
      '  "delete",',
      '  "export",',
      "] as const;",
      "",
      "export function buildAbility(ctx: AppAuthFacts): AppAbility {",
      "  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);",
      "",
      '  can("read", "public_api_sample");',
      "",
      '  if (ctx.principal.kind === "user") {',
      '    can("read", "hello");',
      '    can("read", "auth_matrix_member_route");',
      "    for (const subject of memberTables) {",
      "      for (const action of memberActions) {",
      "        can(action, subject);",
      "      }",
      "    }",
      "  }",
      "",
      "  if (",
      '    ctx.principal.kind === "user" &&',
      '    ctx.principal.membership.roles.includes("owner")',
      "  ) {",
      '    can("read", "auth_matrix_owner_route");',
      '    can("manage", "all");',
      "  }",
      "",
      "  return build();",
      "}",
      "",
    ].join("\n"),
  );
}

export function writeAuthMatrixAppRoutes(projectDir: string): void {
  const appDir = join(projectDir, "packages", "api", "app");
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "auth-matrix.ts"),
    [
      'import { forbidUnless, TsRestApi, type SapportaEnv } from "@sapporta/server";',
      "",
      "const api = new TsRestApi<SapportaEnv>();",
      "",
      'api.get("/auth-matrix/member", (c) => {',
      '  const auth = c.get("auth");',
      '  forbidUnless(c, auth.ability.can("read", "auth_matrix_member_route"));',
      "  return c.json({",
      "    ok: true,",
      "    principal: auth.principal.kind,",
      "  });",
      "});",
      "",
      'api.get("/auth-matrix/owner", (c) => {',
      '  const auth = c.get("auth");',
      '  forbidUnless(c, auth.ability.can("read", "auth_matrix_owner_route"));',
      "  return c.json({",
      "    ok: true,",
      "    principal: auth.principal.kind,",
      "  });",
      "});",
      "",
      "export default api;",
      "",
    ].join("\n"),
  );
  patchGeneratedAppRoute(projectDir, {
    importMarker: 'import publicApiSample from "./app/public-api-sample.js";',
    importReplacement: [
      'import publicApiSample from "./app/public-api-sample.js";',
      'import authMatrixTestApi from "./app/auth-matrix.js";',
    ].join("\n"),
    routeMarker: '  app.route("/", publicApiSample);',
    routeReplacement: [
      '  app.route("/", publicApiSample);',
      '  app.route("/", authMatrixTestApi);',
    ].join("\n"),
  });
}

function patchGeneratedAppRoute(
  projectDir: string,
  patch: {
    importMarker: string;
    importReplacement: string;
    routeMarker: string;
    routeReplacement: string;
  },
): void {
  const appPath = join(projectDir, "packages", "api", "app.ts");
  let appSource = readFileSync(appPath, "utf-8");
  appSource = replaceProjectSourceOnce(
    appSource,
    patch.importMarker,
    patch.importReplacement,
    {
      filePath: appPath,
      label: "auth matrix route import",
    },
  );
  appSource = replaceProjectSourceOnce(
    appSource,
    patch.routeMarker,
    patch.routeReplacement,
    {
      filePath: appPath,
      label: "auth matrix route mount",
    },
  );
  writeFileSync(appPath, appSource);
}

function replaceProjectSourceOnce(
  source: string,
  marker: string,
  replacement: string,
  context: { filePath: string; label: string },
): string {
  if (source.includes(replacement)) {
    return source;
  }
  const count = countOccurrences(source, marker);
  if (count !== 1) {
    throw new Error(
      [
        `Could not patch generated project file: ${context.label}.`,
        `File: ${context.filePath}`,
        `Expected one marker, found ${count}.`,
        "Marker:",
        marker,
      ].join("\n"),
    );
  }
  return source.replace(marker, replacement);
}

export function writeProjectsSchema(projectDir: string): void {
  mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
  writeFileSync(
    join(projectDir, "packages", "api", "schema", "projects.ts"),
    [
      'import { sapportaTable, timestamp, sqliteTable, text, select, integer } from "@sapporta/server/table";',
      "",
      'export const projectsTable = sqliteTable("projects", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      '  status: select("status", ["active", "paused", "done"]).notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  created_at: timestamp("created_at"),',
      '  updated_at: timestamp("updated_at"),',
      "});",
      "",
      "export const projects = sapportaTable({",
      "  drizzle: projectsTable,",
      "  meta: {",
      '    label: "Projects",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["name"],',
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

export async function runDrizzleMigrations(
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

export async function buildGeneratedApiProject(
  project: E2eProject,
): Promise<void> {
  await step("pnpm build (api)", () =>
    run("pnpm", ["--filter", "./packages/api", "build"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 120_000,
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
  const result = parseJsonOutput<{
    exists: boolean;
    columns: SqliteTableColumn[];
  }>(output);
  expect(result.exists, `Expected SQLite table ${tableName} to exist`).toBe(
    true,
  );
  expect(result.columns.map((column) => column.name)).toEqual(
    expect.arrayContaining(expectedColumns),
  );
}

export async function assertSqliteTableMissing(
  project: E2eProject,
  tableName: string,
): Promise<void> {
  const databasePath = join(project.projectDir, "data", "sqlite.db");
  const queryScript = [
    'import Database from "better-sqlite3";',
    `const db = new Database(${JSON.stringify(databasePath)}, { readonly: true });`,
    `const tableName = ${JSON.stringify(tableName)};`,
    'const table = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", tableName);',
    "db.close();",
    "console.log(JSON.stringify({ exists: Boolean(table) }));",
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
  const result = parseJsonOutput<{ exists: boolean }>(output);
  expect(result.exists, `Expected SQLite table ${tableName} not to exist`).toBe(
    false,
  );
}

export function makeCookieJar(project: E2eProject, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  return join(project.parentDir, `${safeName}.cookies.txt`);
}

export function signUpEmailUser(
  baseUrl: string,
  credentials: EmailUserCredentials,
): Promise<SignedInEmailUser>;
export function signUpEmailUser(
  project: E2eProject,
  baseUrl: string,
  credentials: EmailUserCredentials,
): Promise<SignedInEmailUser>;
export async function signUpEmailUser(
  projectOrBaseUrl: E2eProject | string,
  baseUrlOrCredentials: string | EmailUserCredentials,
  maybeCredentials?: EmailUserCredentials,
): Promise<SignedInEmailUser> {
  const project =
    typeof projectOrBaseUrl === "string" ? undefined : projectOrBaseUrl;
  const baseUrl =
    typeof projectOrBaseUrl === "string"
      ? projectOrBaseUrl
      : String(baseUrlOrCredentials);
  const credentials =
    typeof baseUrlOrCredentials === "string"
      ? maybeCredentials
      : baseUrlOrCredentials;
  if (!credentials) {
    throw new Error("Email credentials are required.");
  }
  const cookieFile =
    credentials.cookieFile ??
    (project ? makeCookieJar(project, credentials.email) : undefined);
  if (!cookieFile) {
    throw new Error("A cookie file is required when no project is provided.");
  }
  const body = {
    email: credentials.email,
    password: credentials.password,
    ...(credentials.name === undefined ? {} : { name: credentials.name }),
  };
  await requestJson<unknown>(baseUrl, "/api/auth/sign-up/email", {
    cookieFile,
    method: "POST",
    body,
    expectedSuccess: true,
  });
  return {
    email: credentials.email,
    password: credentials.password,
    cookieFile,
  };
}

export function signInEmailUser(
  baseUrl: string,
  credentials: Pick<EmailUserCredentials, "email" | "password" | "cookieFile">,
): Promise<SignedInEmailUser>;
export function signInEmailUser(
  project: E2eProject,
  baseUrl: string,
  credentials: Pick<EmailUserCredentials, "email" | "password" | "cookieFile">,
): Promise<SignedInEmailUser>;
export async function signInEmailUser(
  projectOrBaseUrl: E2eProject | string,
  baseUrlOrCredentials:
    string | Pick<EmailUserCredentials, "email" | "password" | "cookieFile">,
  maybeCredentials?: Pick<
    EmailUserCredentials,
    "email" | "password" | "cookieFile"
  >,
): Promise<SignedInEmailUser> {
  const project =
    typeof projectOrBaseUrl === "string" ? undefined : projectOrBaseUrl;
  const baseUrl =
    typeof projectOrBaseUrl === "string"
      ? projectOrBaseUrl
      : String(baseUrlOrCredentials);
  const credentials =
    typeof baseUrlOrCredentials === "string"
      ? maybeCredentials
      : baseUrlOrCredentials;
  if (!credentials) {
    throw new Error("Email credentials are required.");
  }
  const cookieFile =
    credentials.cookieFile ??
    (project ? makeCookieJar(project, credentials.email) : undefined);
  if (!cookieFile) {
    throw new Error("A cookie file is required when no project is provided.");
  }
  await requestJson<unknown>(baseUrl, "/api/auth/sign-in/email", {
    cookieFile,
    method: "POST",
    body: {
      email: credentials.email,
      password: credentials.password,
    },
    expectedSuccess: true,
  });
  return {
    email: credentials.email,
    password: credentials.password,
    cookieFile,
  };
}

export async function signOutUser(
  baseUrl: string,
  cookieFile: string,
): Promise<void> {
  await requestJson<unknown>(baseUrl, "/api/auth/sign-out", {
    cookieFile,
    method: "POST",
    body: {},
    expectedSuccess: true,
  });
}

export async function readSqliteRows<T extends Record<string, unknown>>(
  project: E2eProject,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<T[]> {
  const databasePath = join(project.projectDir, "data", "sqlite.db");
  const queryScript = [
    'import Database from "better-sqlite3";',
    `const db = new Database(${JSON.stringify(databasePath)}, { readonly: true });`,
    `const rows = db.prepare(${JSON.stringify(sql)}).all(...${JSON.stringify(params)});`,
    "db.close();",
    "console.log(JSON.stringify(rows));",
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
  return parseJsonOutput<T[]>(output);
}

export async function runSqliteStatement(
  project: E2eProject,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<SqliteStatementResult> {
  const databasePath = join(project.projectDir, "data", "sqlite.db");
  const queryScript = [
    'import Database from "better-sqlite3";',
    `const db = new Database(${JSON.stringify(databasePath)});`,
    `const result = db.prepare(${JSON.stringify(sql)}).run(...${JSON.stringify(params)});`,
    "db.close();",
    "console.log(JSON.stringify({ changes: result.changes, lastInsertRowid: result.lastInsertRowid }));",
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
  return parseJsonOutput<SqliteStatementResult>(output);
}

export function parseJsonOutput<T>(output: string): T {
  const lines = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      continue;
    }
  }

  return JSON.parse(output) as T;
}

export async function addWorkspaceMember(
  project: E2eProject,
  input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceMemberRole;
  },
): Promise<string> {
  const memberId = randomUUID();
  await runSqliteStatement(
    project,
    "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)",
    [memberId, input.workspaceId, input.userId, input.role, Date.now()],
  );
  return memberId;
}

export async function prepareDockerReleaseProject(
  project: E2eProject,
): Promise<void> {
  // This path is deliberately more complicated than the ordinary init e2e.
  //
  // The generated project is a release-candidate probe for this checkout: it
  // should build a Docker image that installs Sapporta exactly as an end user
  // would, but using tarballs produced from the local monorepo. If any
  // @sapporta/* package resolves from npm, the test can accidentally combine
  // current templates with already-published framework packages. That is not a
  // release test; it is registry roulette, and TypeScript can make it worse by
  // merging same-name package IDs from stale registry copies.
  const specs = await packSapportaPackagesForProject(project);
  makeDockerfileCopyPackedSapportaPackages(project.projectDir);
  writePnpmfileForPackedSapportaPackages(
    project.projectDir,
    specs.workspacePackage,
  );
  rewritePackageJson(join(project.projectDir, "package.json"), specs.root);
  rewritePackageJson(
    join(project.projectDir, "packages", "api", "package.json"),
    specs.workspacePackage,
  );
  rewritePackageJson(
    join(project.projectDir, "packages", "frontend", "package.json"),
    specs.workspacePackage,
  );
  rewritePackageJson(
    join(project.projectDir, "packages", "shared", "package.json"),
    specs.workspacePackage,
  );

  await step("pnpm install after Docker release dependency rewrite", () =>
    run("pnpm", ["install"], {
      cwd: project.projectDir,
      env: project.env,
      timeoutMs: 120_000,
    }),
  );
  assertNoRegistrySapportaPackages(project.projectDir);
}

type PackedSapportaSpecs = {
  /** Specs resolved from the generated project root, e.g. root package.json. */
  root: Record<string, string>;
  /** Specs resolved from packages/api or packages/frontend package.json. */
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
  // The .pnpmfile.cjs matters for the same reason. Docker rebuilds dependencies
  // from the lockfile with --frozen-lockfile; if the pnpmfile was present when
  // the lockfile was generated but absent in the image install layers, pnpm may
  // reject the lockfile or reinstall a different graph.
  //
  // The patch is test-only and deliberately anchored to exact Dockerfile lines:
  // if the template changes, fail here with context instead of silently building
  // an image that falls back to registry packages or misses runtime files.
  const dockerfilePath = join(projectDir, "Dockerfile");
  let dockerfile = readFileSync(dockerfilePath, "utf-8");
  const rootManifestCopy =
    "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./\n";
  const rootManifestCopyWithPnpmfile =
    rootManifestCopy + "COPY .pnpmfile.cjs .pnpmfile.cjs\n";
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

  // Avoid runtime `pnpm --filter`: with file: tarballs it may try to resolve or
  // relink workspace state in a non-TTY container. The package-local Drizzle
  // binary is already installed and exercises the same migration command.
  const packedArtifactRuntimeCommand =
    'CMD ["sh", "-c", "cd packages/api && ./node_modules/.bin/drizzle-kit migrate && node dist/boot.js"]';

  dockerfile = replaceAllRequired(
    dockerfile,
    rootManifestCopy,
    rootManifestCopyWithPnpmfile,
    {
      label: "install-stage root manifest copy",
      expectedCount: 2,
      dockerfilePath,
    },
  );
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

function writePnpmfileForPackedSapportaPackages(
  projectDir: string,
  sapportaSpecs: Record<string, string>,
): void {
  // Rewriting direct generated-package dependencies is not enough. The packed
  // @sapporta/server tarball still declares @sapporta/shared, and the packed
  // frontend/grid packages declare their own @sapporta/* dependencies. pnpm
  // will happily satisfy those transitive edges from the registry unless a
  // readPackage hook rewrites the package manifests as they are resolved.
  //
  // The specs passed here are relative to generated workspace packages
  // (`packages/api`, `packages/frontend`) because pnpm resolves file: specs in
  // dependency manifests from the importer that is installing the dependency.
  // Root-relative specs would point at packages/api/.sapporta-packages and fail.
  writeFileSync(
    join(projectDir, ".pnpmfile.cjs"),
    [
      '"use strict";',
      "",
      [
        "// Test-only release-candidate wiring.",
        "// Force packed Sapporta tarballs to depend on this checkout instead",
        "// of published @sapporta/* packages from npm.",
      ].join("\n"),
      `const sapportaSpecs = ${JSON.stringify(sapportaSpecs, null, 2)};`,
      "",
      "function rewrite(dependencies) {",
      "  if (!dependencies) return;",
      "  for (const [packageName, spec] of Object.entries(sapportaSpecs)) {",
      "    if (dependencies[packageName]) dependencies[packageName] = spec;",
      "  }",
      "}",
      "",
      "module.exports = {",
      "  hooks: {",
      "    readPackage(pkg) {",
      [
        "      // Do not rewrite the generated app packages themselves: their",
        "      // package.json files already use importer-relative tarball specs.",
      ].join("\n"),
      '      if (!pkg.name || !pkg.name.startsWith("@sapporta/")) return pkg;',
      "      rewrite(pkg.dependencies);",
      "      rewrite(pkg.optionalDependencies);",
      "      rewrite(pkg.devDependencies);",
      "      return pkg;",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
}

function assertNoRegistrySapportaPackages(projectDir: string): void {
  // This assertion is intentionally narrow: @sapporta/rest-core and
  // @sapporta/rest-open-api are third-party ts-rest packages that are expected
  // to come from the registry. Only the Sapporta packages produced by this
  // monorepo must be closed over local tarballs.
  const lockfilePath = join(projectDir, "pnpm-lock.yaml");
  const lockfile = readFileSync(lockfilePath, "utf-8");
  const registryPackageEntries = Object.keys(SAPPORTA_PACKAGE_DIRS).flatMap(
    (packageName) =>
      lockfile.match(
        new RegExp(`^ {2}'${escapeRegExp(packageName)}@(?!file:)`, "gm"),
      ) ?? [],
  );
  expect(
    registryPackageEntries.length === 0 ? null : registryPackageEntries,
    [
      "Expected Docker release lockfile to use only packed Sapporta tarballs.",
      `Lockfile: ${lockfilePath}`,
    ].join("\n"),
  ).toBeNull();
  for (const packageName of Object.keys(SAPPORTA_PACKAGE_DIRS)) {
    expect(lockfile).not.toContain(`registry.npmjs.org/${packageName}/`);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];

  const serverProcess = await step("boot scaffolded server", async () => {
    const nodeArgs = project.env.SAPPORTA_PACKAGE_ROOT
      ? ["--import", "@sapporta/server/source-link-runtime", "dist/boot.js"]
      : ["dist/boot.js"];
    const child = spawn("node", nodeArgs, {
      cwd: join(project.projectDir, "packages", "api"),
      env: {
        ...project.env,
        ...envOverrides,
        SAPPORTA_PUBLIC_APP_URL:
          envOverrides.SAPPORTA_PUBLIC_APP_URL ?? baseUrl,
        SAPPORTA_REQUIRE_VERIFIED_EMAIL:
          envOverrides.SAPPORTA_REQUIRE_VERIFIED_EMAIL ?? "false",
        SAPPORTA_API_PORT: String(port),
      },
      stdio: "pipe",
    });

    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

    try {
      await waitForJson(`${baseUrl}${options.readyPath ?? "/health"}`);
    } catch (err) {
      console.error("Server failed to start. Output:\n" + output.join(""));
      child.kill("SIGTERM");
      throw err;
    }

    return child;
  });

  return { process: serverProcess, baseUrl, output };
}

export async function expectBuiltServerBootFailure(
  project: E2eProject,
  envOverrides: NodeJS.ProcessEnv = {},
  timeoutMs = 15_000,
): Promise<BootFailure> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const child = spawn("node", ["packages/api/dist/boot.js"], {
    cwd: project.projectDir,
    env: {
      ...project.env,
      ...envOverrides,
      SAPPORTA_PUBLIC_APP_URL: envOverrides.SAPPORTA_PUBLIC_APP_URL ?? baseUrl,
      SAPPORTA_REQUIRE_VERIFIED_EMAIL:
        envOverrides.SAPPORTA_REQUIRE_VERIFIED_EMAIL ?? "false",
      SAPPORTA_API_PORT: String(port),
    },
    stdio: "pipe",
  });

  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          [
            `Expected scaffolded server boot to fail within ${timeoutMs}ms.`,
            "Output:",
            output.join(""),
          ].join("\n"),
        ),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        reject(
          new Error(
            [
              "Expected scaffolded server boot to fail, but it exited cleanly.",
              "Output:",
              output.join(""),
            ].join("\n"),
          ),
        );
        return;
      }
      resolve({ baseUrl, code, signal, output });
    });
  });
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
  const containerPort = 3100;
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
          `127.0.0.1:${port}:${containerPort}`,
          // Hosting platforms conventionally assign PORT. Exercise that
          // compatibility path instead of Sapporta's namespaced override.
          "-e",
          `PORT=${containerPort}`,
          // The generated auth template is production-shaped even in tests: it
          // refuses to boot without a Better Auth secret/public URL, and Better
          // Auth checks request origins on credentialed auth routes. Use the
          // externally mapped localhost URL because that is what curl sees.
          "-e",
          `BETTER_AUTH_SECRET=${project.env.BETTER_AUTH_SECRET ?? "sapporta-e2e-generated-project-secret"}`,
          "-e",
          `SAPPORTA_PUBLIC_APP_URL=${baseUrl}`,
          "-e",
          `SAPPORTA_FRONTEND_ORIGINS=${baseUrl}`,
          "-e",
          `SAPPORTA_REQUIRE_VERIFIED_EMAIL=${project.env.SAPPORTA_REQUIRE_VERIFIED_EMAIL ?? "false"}`,
          "-e",
          `SAPPORTA_MAIL_FROM=${project.env.SAPPORTA_MAIL_FROM ?? "Sapporta <no-reply@example.test>"}`,
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

export function requestJson<T>(
  url: string,
  opts?: JsonRequestOptions,
): Promise<JsonResponse<T>>;
export function requestJson<T>(
  baseUrl: string,
  path: string,
  opts?: JsonRequestOptions,
): Promise<JsonResponse<T>>;
export async function requestJson<T>(
  urlOrBaseUrl: string,
  pathOrOpts: string | JsonRequestOptions = {},
  maybeOpts: JsonRequestOptions = {},
): Promise<JsonResponse<T>> {
  const url =
    typeof pathOrOpts === "string"
      ? `${urlOrBaseUrl}${pathOrOpts}`
      : urlOrBaseUrl;
  const opts = typeof pathOrOpts === "string" ? maybeOpts : pathOrOpts;
  const headersFile = join(
    tmpdir(),
    `sapporta-e2e-headers-${Date.now()}-${Math.random()}.txt`,
  );
  const args = ["-g", "-sS", "-D", headersFile];
  if (opts.cookieFile) {
    args.push("-b", opts.cookieFile, "-c", opts.cookieFile);
  }
  if (opts.method) {
    args.push("-X", opts.method);
  }

  const requestHeaders = new Map<string, string>();
  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    requestHeaders.set(name.toLowerCase(), value);
  }
  if (
    new URL(url).pathname.startsWith("/api/auth/") &&
    !requestHeaders.has("x-forwarded-for")
  ) {
    requestHeaders.set("x-forwarded-for", authRequestIp(url, opts));
  }
  if (opts.body !== undefined && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  if (opts.origin !== undefined && opts.origin !== null) {
    requestHeaders.set("origin", opts.origin);
  } else if (opts.body !== undefined && opts.origin !== null) {
    requestHeaders.set("origin", new URL(url).origin);
  }
  for (const [name, value] of requestHeaders) {
    args.push("-H", `${name}: ${value}`);
  }

  if (opts.body !== undefined) {
    args.push("--data", JSON.stringify(opts.body));
  }
  args.push("-w", "\n%{http_code}");
  args.push(url);

  try {
    const output = await runText("curl", args, {
      cwd: opts.cwd ?? MONOREPO_ROOT,
      env: opts.env ?? process.env,
      timeoutMs: opts.timeoutMs ?? 30_000,
    });
    const separator = output.lastIndexOf("\n");
    const rawBody = separator === -1 ? output : output.slice(0, separator);
    const status = Number(separator === -1 ? "0" : output.slice(separator + 1));
    const response: JsonResponse<T> = {
      status,
      body: parseJsonBody<T>(rawBody),
      rawBody,
      headers: parseResponseHeaders(readFileSync(headersFile, "utf-8")),
    };
    if (opts.expectedStatus !== undefined) {
      const statuses =
        typeof opts.expectedStatus === "number"
          ? [opts.expectedStatus]
          : [...opts.expectedStatus];
      expect(
        statuses,
        formatHttpExpectationMessage(statuses, response, opts.serverOutput),
      ).toContain(status);
    }
    if (opts.expectedSuccess === true && (status < 200 || status >= 300)) {
      throw new Error(
        formatHttpExpectationMessage([200, 299], response, opts.serverOutput),
      );
    }
    return response;
  } finally {
    rmSync(headersFile, { force: true });
  }
}

function parseJsonBody<T>(rawBody: string): T {
  if (rawBody.length === 0) return undefined as T;
  try {
    return JSON.parse(rawBody) as T;
  } catch {
    return rawBody as T;
  }
}

function authRequestIp(url: string, opts: JsonRequestOptions): string {
  const seed = `${opts.cookieFile ?? ""}:${requestBodyEmail(opts.body) ?? ""}:${url}`;
  const hash = positiveHash(seed);
  const second = 64 + (hash % 64);
  const third = (hash >>> 8) % 256;
  const fourth = 1 + ((hash >>> 16) % 254);
  return `10.${second}.${third}.${fourth}`;
}

function requestBodyEmail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return undefined;
  }
  const email = body.email;
  return typeof email === "string" ? email : undefined;
}

function positiveHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function parseResponseHeaders(rawHeaders: string): RequestHeaders {
  const headers: RequestHeaders = {};
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name) continue;
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

function formatHttpExpectationMessage<T>(
  expectedStatuses: readonly number[],
  response: JsonResponse<T>,
  serverOutput: readonly string[] = [],
): string {
  return [
    `Expected HTTP ${expectedStatuses.join(" or ")}, got ${response.status}: ${response.rawBody}`,
    ...(serverOutput.length === 0 ? [] : ["Server output:", ...serverOutput]),
  ].join("\n");
}

export function expectHttpError(
  response: JsonResponse<unknown>,
  expectedStatus: number,
  expectedBody: { code?: string; error?: string | RegExp } = {},
): void {
  expect(response.status).toBe(expectedStatus);
  const body = response.body;
  expect(body).toEqual(expect.any(Object));
  const objectBody = body as Record<string, unknown>;
  if (expectedBody.code !== undefined) {
    expect(objectBody.code).toBe(expectedBody.code);
  }
  if (expectedBody.error !== undefined) {
    if (expectedBody.error instanceof RegExp) {
      expect(String(objectBody.error ?? "")).toMatch(expectedBody.error);
    } else {
      expect(objectBody.error).toBe(expectedBody.error);
    }
  }
}

export function expectAuthContext(
  context: AuthContextBody,
  expected: AuthContextExpectation,
): void {
  if (expected.email !== undefined) {
    expect(context.user.email).toBe(expected.email);
  }
  if (expected.workspaceId !== undefined) {
    expect(context.workspace.id).toBe(expected.workspaceId);
  }
  if (expected.workspaceName !== undefined) {
    expect(context.workspace.name).toBe(expected.workspaceName);
  }
  if (expected.workspaceSlug !== undefined) {
    expect(context.workspace.slug).toBe(expected.workspaceSlug);
  }
  if (expected.role !== undefined) {
    expect(context.role ?? context.memberships[0]?.role).toBe(expected.role);
  }
  if (expected.isOwner !== undefined) {
    expect(context.isOwner ?? context.memberships[0]?.isOwner).toBe(
      expected.isOwner,
    );
  }
}

export function expectVisibleTitles<T extends { title?: unknown }>(
  rowsOrBody: readonly T[] | { data: readonly T[] },
  expectedTitles: readonly string[],
): void {
  const rows: readonly T[] =
    "data" in rowsOrBody ? rowsOrBody.data : rowsOrBody;
  expect(rows.map((row) => row.title)).toEqual(expectedTitles);
}

export function expectNoScopeLeak<T extends Record<string, unknown>>(
  rowsOrBody: readonly T[] | { data: readonly T[] },
  expectedScope: { workspaceId?: string; scopedToUserId?: string },
): void {
  const rows: readonly T[] =
    "data" in rowsOrBody ? rowsOrBody.data : rowsOrBody;
  for (const row of rows) {
    if ("workspace_id" in row && expectedScope.workspaceId !== undefined) {
      expect(row.workspace_id).toBe(expectedScope.workspaceId);
    }
    if (
      "scoped_to_user_id" in row &&
      expectedScope.scopedToUserId !== undefined
    ) {
      expect(row.scoped_to_user_id).toBe(expectedScope.scopedToUserId);
    }
  }
}

export async function expectTableRowCount(
  project: E2eProject,
  tableName: string,
  expectedCount: number,
  whereSql?: string,
  params: readonly SqliteValue[] = [],
): Promise<void> {
  assertSqlIdentifier(tableName);
  const rows = await readSqliteRows<{ count: number }>(
    project,
    [
      `SELECT COUNT(*) AS count FROM "${tableName}"`,
      whereSql === undefined ? "" : `WHERE ${whereSql}`,
    ]
      .filter(Boolean)
      .join(" "),
    params,
  );
  expect(rows[0]?.count).toBe(expectedCount);
}

function assertSqlIdentifier(identifier: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }
}

export async function curlText(
  url: string,
  opts: { method?: string; body?: unknown } & AuthCookieOptions = {},
): Promise<string> {
  const args = ["-g", "-sS"];
  if (opts.cookieFile) {
    args.push("-b", opts.cookieFile, "-c", opts.cookieFile);
  }
  if (opts.method) {
    args.push("-X", opts.method);
  }
  if (opts.body !== undefined) {
    args.push("-H", "Content-Type: application/json");
    // Better Auth rejects mutating auth requests without an Origin header.
    // Browser clients always send one; curl does not, so the e2e harness adds
    // the same-origin value explicitly.
    args.push("-H", `Origin: ${new URL(url).origin}`);
    args.push("--data", JSON.stringify(opts.body));
  }
  args.push("-w", "\n%{http_code}");
  args.push(url);
  const output = await runText("curl", args, {
    cwd: MONOREPO_ROOT,
    env: process.env,
    timeoutMs: 30_000,
  });
  const separator = output.lastIndexOf("\n");
  const body = separator === -1 ? output : output.slice(0, separator);
  const status = Number(separator === -1 ? "0" : output.slice(separator + 1));
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status}: ${body}`);
  }
  return body;
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
