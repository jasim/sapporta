import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertBetterSqliteLoads,
  assertSqliteTable,
  assertSqliteTableMissing,
  buildGeneratedApiProject,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  expectBuiltServerBootFailure,
  generateDrizzleMigration,
  makeCookieJar,
  requestJson,
  runDrizzleMigrationCycle,
  runDrizzleMigrations,
  scaffoldProject,
  signInEmailUser,
  signUpEmailUser,
  startBuiltServer,
  stopServer,
  writeAuthScopedTasksSchema,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

describe("sapporta init auth template - CORS and health policy", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-policy-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAuthScopedTasksSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "auth_policy_tasks");
    await buildGeneratedProject(project);
  }, 420_000);

  afterEach(() => {
    stopServer(server);
    server = undefined;
  });

  afterAll(() => {
    cleanupProject(project);
  });

  it("allows credentialed CORS only for exact trusted origins", async () => {
    const trustedOne = "http://localhost:5173";
    const trustedTwo = "http://localhost:5174";
    server = await startBuiltServer(
      project!,
      {
        SAPPORTA_FRONTEND_ORIGINS: `${trustedOne}, ${trustedTwo}`,
      },
      { readyPath: "/api/meta/info" },
    );

    const sameOrigin = await requestJson<{ name: string }>(
      server.baseUrl,
      "/api/meta/info",
      { expectedStatus: 200 },
    );
    expect(sameOrigin.body.name).toBe("test-project");
    expect(sameOrigin.headers["access-control-allow-origin"]).toBeUndefined();

    const trusted = await requestJson<{ name: string }>(
      server.baseUrl,
      "/api/meta/info",
      { origin: trustedOne, expectedStatus: 200 },
    );
    expect(trusted.headers["access-control-allow-origin"]).toBe(trustedOne);
    expect(trusted.headers["access-control-allow-credentials"]).toBe("true");

    const secondTrusted = await requestJson<{ name: string }>(
      server.baseUrl,
      "/api/meta/info",
      { origin: trustedTwo, expectedStatus: 200 },
    );
    expect(secondTrusted.headers["access-control-allow-origin"]).toBe(
      trustedTwo,
    );

    const preflight = await requestJson<unknown>(
      server.baseUrl,
      "/api/meta/info",
      {
        method: "OPTIONS",
        origin: trustedOne,
        headers: {
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
        expectedStatus: [200, 204],
      },
    );
    expect(preflight.headers["access-control-allow-origin"]).toBe(trustedOne);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");

    const untrusted = await requestJson<{ name: string }>(
      server.baseUrl,
      "/api/meta/info",
      { origin: "http://localhost:5173.evil.test", expectedStatus: 200 },
    );
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects wildcard and non-origin frontend origins before serving", async () => {
    const wildcardFailure = await expectBuiltServerBootFailure(project!, {
      SAPPORTA_FRONTEND_ORIGINS: "*",
    });
    expect(wildcardFailure.output.join("")).toContain(
      "SAPPORTA_FRONTEND_ORIGINS must contain valid URL origins",
    );

    const pathFailure = await expectBuiltServerBootFailure(project!, {
      SAPPORTA_FRONTEND_ORIGINS: "http://localhost:5173/app",
    });
    expect(pathFailure.output.join("")).toContain(
      "SAPPORTA_FRONTEND_ORIGINS must contain origins only",
    );
  });

  it("rejects conflicting Sapporta and hosting-platform ports", async () => {
    const failure = await expectBuiltServerBootFailure(project!, {
      PORT: "1",
    });
    expect(failure.output.join("")).toContain(
      "SAPPORTA_API_PORT and PORT must match when both are set",
    );
  });

  it("serves public health without a session", async () => {
    server = await startBuiltServer(
      project!,
      { SAPPORTA_HEALTH_POLICY: "public" },
      { readyPath: "/api/meta/info" },
    );

    const health = await requestJson<{ status: string }>(
      server.baseUrl,
      "/health",
      { expectedStatus: 200 },
    );

    expect(health.body).toEqual({ status: "ok" });
  });

  it("requires a signed-in user for authenticated health", async () => {
    server = await startBuiltServer(
      project!,
      { SAPPORTA_HEALTH_POLICY: "authenticated" },
      { readyPath: "/api/meta/info" },
    );

    const anonymous = await requestJson<{ code: string }>(
      server.baseUrl,
      "/health",
      { expectedStatus: 401, serverOutput: server.output },
    );
    expect(anonymous.body.code).toBe("unauthenticated");

    const cookieFile = makeCookieJar(project!, "authenticated-health");
    const credentials = {
      email: "health-owner@example.test",
      password: "SapportaAuthE2ePassword1!",
      name: "Health Owner",
      cookieFile,
    };
    await signUpEmailUser(project!, server.baseUrl, credentials);
    await signInEmailUser(project!, server.baseUrl, credentials);

    const signedIn = await requestJson<{ status: string }>(
      server.baseUrl,
      "/health",
      { cookieFile, expectedStatus: 200, serverOutput: server.output },
    );
    expect(signedIn.body).toEqual({ status: "ok" });
  });

  /**
   * One server, both halves of the policy: the contract has to be readable
   * without a credential, and nothing that reads data may follow it out.
   * `POST /api/meta/sql` runs arbitrary statements under the same
   * `/api/meta/*` prefix that already carries a public route, so it is the
   * one that would break first. Both gates are live here — the project's
   * anonymous gate over `/api/*` and the framework's own route policy.
   */
  it("serves the app contract but no data under the public policy", async () => {
    server = await startBuiltServer(
      project!,
      { SAPPORTA_OPENAPI_POLICY: "public" },
      { readyPath: "/api/meta/info" },
    );

    const contract = await requestJson<{
      openapi: string;
      paths: Record<string, unknown>;
    }>(server.baseUrl, "/api/openapi.json", { expectedStatus: 200 });
    expect(contract.body.openapi).toMatch(/^3\./);
    expect(Object.keys(contract.body.paths).length).toBeGreaterThan(0);

    const sql = await requestJson<{ code: string }>(
      server.baseUrl,
      "/api/meta/sql",
      {
        method: "POST",
        body: { sql: "SELECT 1" },
        expectedStatus: 401,
        serverOutput: server.output,
      },
    );
    expect(sql.body.code).toBe("unauthenticated");

    const rows = await requestJson<{ code: string }>(
      server.baseUrl,
      "/api/tables/tasks",
      { expectedStatus: 401, serverOutput: server.output },
    );
    expect(rows.body.code).toBe("unauthenticated");
  });

  it("requires a session for the app contract when no policy is set", async () => {
    server = await startBuiltServer(
      project!,
      {},
      {
        readyPath: "/api/meta/info",
      },
    );

    const anonymous = await requestJson<{ code: string }>(
      server.baseUrl,
      "/api/openapi.json",
      { expectedStatus: 401, serverOutput: server.output },
    );

    expect(anonymous.body.code).toBe("unauthenticated");
  });

  it("does not serve the app contract when disabled", async () => {
    server = await startBuiltServer(
      project!,
      { SAPPORTA_OPENAPI_POLICY: "disabled" },
      { readyPath: "/api/meta/info" },
    );

    const contract = await requestJson<unknown>(
      server.baseUrl,
      "/api/openapi.json",
      { expectedStatus: 404, serverOutput: server.output },
    );

    expect(contract.status).toBe(404);
  });

  it("does not mount health when disabled", async () => {
    server = await startBuiltServer(
      project!,
      { SAPPORTA_HEALTH_POLICY: "disabled" },
      { readyPath: "/api/meta/info" },
    );

    const health = await requestJson<unknown>(server.baseUrl, "/health", {
      expectedStatus: 404,
    });
    expect(health.status).toBe(404);
  });
});

describe("sapporta init auth template - boot validation", () => {
  let project: E2eProject | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-boot-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
  }, 420_000);

  afterAll(() => {
    cleanupProject(project);
  });

  it("fails on pending migrations without creating product tables at boot", async () => {
    writeBootReadySchema(project!.projectDir);
    await generateDrizzleMigration(project!, "pending_boot_ready_tasks");
    await buildGeneratedApiProject(project!);

    const failure = await expectBuiltServerBootFailure(project!);
    expect(failure.output.join("")).toContain(
      "Sapporta migrations are not ready",
    );
    expect(failure.output.join("")).toContain("Pending migration");
    await assertSqliteTableMissing(project!, "boot_ready_tasks");

    await runDrizzleMigrations(project!, "pending_boot_ready_tasks");
    await assertSqliteTable(project!, "boot_ready_tasks", [
      "id",
      "title",
      "workspace_id",
      "scoped_to_user_id",
    ]);

    const server = await startBuiltServer(
      project!,
      {},
      { readyPath: "/api/meta/info" },
    );
    stopServer(server);
  }, 180_000);

  it("rejects unsafe auth schema definitions before serving", async () => {
    writeInvalidAuthSchema(project!.projectDir);
    await buildGeneratedApiProject(project!);

    const failure = await expectBuiltServerBootFailure(project!);
    const output = failure.output.join("");

    expect(output).toContain("Auth schema validation failed");
    expect(output).toContain("boot_missing_workspace.workspace_id");
    expect(output).toContain("missing_workspace_scope_column");
    expect(output).toContain("boot_missing_user_scope.scoped_to_user_id");
    expect(output).toContain("missing_user_scope_column");
    expect(output).toContain("boot_invalid_scope");
    expect(output).toContain("invalid_row_scope");
    expect(output).toContain("boot_unregistered_ref.account_id");
    expect(output).toContain("unregistered_reference_table");
    expect(output).toContain("boot_unknown_source_ref.missing_account_id");
    expect(output).toContain("unknown_reference_source_column");
    expect(output).toContain("boot_unknown_protected_ref.protected_account_id");
  }, 180_000);
});

function writeSchemaFile(projectDir: string, source: string): void {
  const schemaDir = join(projectDir, "packages", "api", "schema");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "boot-policy.ts"), source);
}

function writeBootReadySchema(projectDir: string): void {
  writeSchemaFile(
    projectDir,
    [
      'import { sapportaTable, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const bootReadyTasksTable = sqliteTable("boot_ready_tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      '  scoped_to_user_id: text("scoped_to_user_id").notNull(),',
      "});",
      "",
      "export const bootReadyTasks = sapportaTable({",
      "  drizzle: bootReadyTasksTable,",
      '  meta: { label: "Boot Ready Tasks", rowScope: "workspaceUserScoped", rowLabelColumns: ["title"] },',
      "});",
      "",
      "export default bootReadyTasks;",
      "",
    ].join("\n"),
  );
}

function writeInvalidAuthSchema(projectDir: string): void {
  writeSchemaFile(
    projectDir,
    [
      'import { sapportaTable, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const bootMissingWorkspaceTable = sqliteTable("boot_missing_workspace", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      "});",
      "export const bootMissingWorkspace = sapportaTable({",
      "  drizzle: bootMissingWorkspaceTable,",
      '  meta: { label: "Missing Workspace", rowScope: "workspaceGlobal", rowLabelColumns: ["name"] },',
      "});",
      "",
      'export const bootMissingUserScopeTable = sqliteTable("boot_missing_user_scope", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "export const bootMissingUserScope = sapportaTable({",
      "  drizzle: bootMissingUserScopeTable,",
      '  meta: { label: "Missing User Scope", rowScope: "workspaceUserScoped", rowLabelColumns: ["name"] },',
      "});",
      "",
      'export const bootInvalidScopeTable = sqliteTable("boot_invalid_scope", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  name: text("name").notNull(),',
      "});",
      "export const bootInvalidScope = sapportaTable({",
      "  drizzle: bootInvalidScopeTable,",
      '  meta: { label: "Invalid Scope", rowScope: "tenantScoped" as never, rowLabelColumns: ["name"] },',
      "});",
      "",
      'export const bootUnregisteredRefTable = sqliteTable("boot_unregistered_ref", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  account_id: integer("account_id").notNull(),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "export const bootUnregisteredRef = sapportaTable({",
      "  drizzle: bootUnregisteredRefTable,",
      "  meta: {",
      '    label: "Unregistered Ref",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["id"],',
      '    references: { account_id: { table: "boot_missing_target" } },',
      "  },",
      "});",
      "",
      'export const bootReferenceTargetTable = sqliteTable("boot_reference_target", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "export const bootReferenceTarget = sapportaTable({",
      "  drizzle: bootReferenceTargetTable,",
      '  meta: { label: "Reference Target", rowScope: "workspaceGlobal", rowLabelColumns: ["id"] },',
      "});",
      "",
      'export const bootUnknownSourceRefTable = sqliteTable("boot_unknown_source_ref", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "export const bootUnknownSourceRef = sapportaTable({",
      "  drizzle: bootUnknownSourceRefTable,",
      "  meta: {",
      '    label: "Unknown Source Ref",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["id"],',
      '    references: { missing_account_id: { table: "boot_reference_target" } },',
      "  },",
      "});",
      "",
      'export const bootUnknownProtectedRefTable = sqliteTable("boot_unknown_protected_ref", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  workspace_id: text("workspace_id").notNull(),',
      "});",
      "export const bootUnknownProtectedRef = sapportaTable({",
      "  drizzle: bootUnknownProtectedRefTable,",
      "  meta: {",
      '    label: "Unknown Protected Ref",',
      '    rowScope: "workspaceGlobal",',
      '    rowLabelColumns: ["id"],',
      '    references: { protected_account_id: { table: "boot_reference_target", apiSettable: false } },',
      "  },",
      "});",
      "",
      "export default bootMissingWorkspace;",
      "",
    ].join("\n"),
  );
}
