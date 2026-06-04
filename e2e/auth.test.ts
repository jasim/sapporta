import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  TASK_ONE,
  TASK_TWO,
  assertBetterSqliteLoads,
  assertSqliteTable,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  runDrizzleMigrationCycle,
  runText,
  scaffoldProject,
  startBuiltServer,
  stopServer,
  writeAuthScopedTasksSchema,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

type AuthContextBody = {
  user: { id: string; email: string };
  workspace: { id: string; name: string; slug: string };
  memberships: Array<{
    workspace: { id: string; name: string; slug: string };
    role: string;
    isOwner: boolean;
  }>;
};

type RowBody = {
  data: {
    id: number;
    title: string;
    status: string;
    priority: number;
    workspace_id?: string;
  };
};

type RowsBody = {
  data: RowBody["data"][];
};

describe("sapporta init auth template - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;
  let cookieJar = "";

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-e2e-" });
    cookieJar = join(project.parentDir, "cookies.txt");
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAuthScopedTasksSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "auth_scoped_tasks");
    await assertSqliteTable(project, "user", ["id", "email", "emailVerified"]);
    await assertSqliteTable(project, "session", [
      "id",
      "token",
      "userId",
      "activeOrganizationId",
    ]);
    await assertSqliteTable(project, "organization", ["id", "name", "slug"]);
    await assertSqliteTable(project, "member", [
      "id",
      "organizationId",
      "userId",
      "role",
    ]);
    await assertSqliteTable(project, "tasks", [
      "id",
      "title",
      "status",
      "priority",
      "workspace_id",
    ]);
    await buildGeneratedProject(project);
    server = await startBuiltServer(project, {
      SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
    });
  }, 420_000);

  afterAll(() => {
    stopServer(server);
    cleanupProject(project);
  });

  it("signs up, provisions workspaces, and scopes table rows to the active workspace", async () => {
    const baseUrl = server!.baseUrl;

    await expect(
      authCurlJson<AuthContextBody>(baseUrl, "/api/auth-context"),
    ).rejects.toThrow();
    await expect(
      authCurlJson<RowsBody>(baseUrl, "/api/tables/tasks"),
    ).rejects.toThrow(/HTTP 401/);

    await authCurlJson<unknown>(baseUrl, "/api/auth/sign-up/email", {
      method: "POST",
      body: {
        email: "owner@example.test",
        password: "correct-horse-battery-staple",
        name: "Owner",
      },
    });
    await authCurlJson<unknown>(baseUrl, "/api/auth/sign-in/email", {
      method: "POST",
      body: {
        email: "owner@example.test",
        password: "correct-horse-battery-staple",
      },
    });

    const firstContext = await authCurlJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
    );
    expect(firstContext.user.email).toBe("owner@example.test");
    expect(firstContext.workspace.name).toBe("Owner's Workspace");
    expect(firstContext.memberships[0]?.isOwner).toBe(true);

    await expect(
      authCurlJson<RowBody>(baseUrl, "/api/tables/tasks", {
        method: "POST",
        body: { ...TASK_ONE, workspace_id: "workspace-2" },
      }),
    ).rejects.toThrow(/HTTP 422/);

    const firstTask = await authCurlJson<RowBody>(
      baseUrl,
      "/api/tables/tasks",
      {
        method: "POST",
        body: TASK_ONE,
      },
    );
    expect(firstTask.data.title).toBe(TASK_ONE.title);
    expect(firstTask.data.workspace_id).toBe(firstContext.workspace.id);

    await authCurlJson<unknown>(baseUrl, "/api/auth/organization/create", {
      method: "POST",
      body: {
        name: "Second Workspace",
        slug: "second-workspace",
      },
    });

    const secondContext = await authCurlJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
    );
    expect(secondContext.workspace.id).not.toBe(firstContext.workspace.id);
    expect(secondContext.workspace.slug).toBe("second-workspace");

    const secondTask = await authCurlJson<RowBody>(
      baseUrl,
      "/api/tables/tasks",
      {
        method: "POST",
        body: TASK_TWO,
      },
    );
    expect(secondTask.data.workspace_id).toBe(secondContext.workspace.id);

    const secondList = await authCurlJson<RowsBody>(
      baseUrl,
      "/api/tables/tasks",
    );
    expect(secondList.data.map((row) => row.title)).toEqual([TASK_TWO.title]);

    await authCurlJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        method: "POST",
        body: { workspaceId: firstContext.workspace.id },
      },
    );

    const firstList = await authCurlJson<RowsBody>(
      baseUrl,
      "/api/tables/tasks",
    );
    expect(firstList.data.map((row) => row.title)).toEqual([TASK_ONE.title]);
  });

  async function authCurlJson<T>(
    baseUrl: string,
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const args = ["-sS", "-c", cookieJar, "-b", cookieJar];
    if (opts.method) {
      args.push("-X", opts.method);
    }
    if (opts.body !== undefined) {
      args.push("-H", "Content-Type: application/json");
      args.push("--data", JSON.stringify(opts.body));
    }
    args.push("-w", "\n%{http_code}", `${baseUrl}${path}`);
    const output = await runText("curl", args, {
      cwd: project!.projectDir,
      env: project!.env,
      timeoutMs: 30_000,
    });
    const separator = output.lastIndexOf("\n");
    const body = separator === -1 ? output : output.slice(0, separator);
    const status = Number(separator === -1 ? "0" : output.slice(separator + 1));
    if (status < 200 || status >= 300) {
      throw new Error(
        [
          `HTTP ${status}: ${body}`,
          "Server output:",
          ...(server?.output ?? []),
        ].join("\n"),
      );
    }
    return JSON.parse(body) as T;
  }
});
