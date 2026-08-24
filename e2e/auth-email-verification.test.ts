import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
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

type RowsBody = {
  data: Array<{
    id: number;
    title: string;
    status: string;
    priority: number;
    workspace_id?: string;
  }>;
};

type StatusBody = {
  status: boolean;
};

type BetterAuthErrorBody = {
  code?: string;
  message?: string;
};

type AuthContextBody = {
  user: { id: string; email: string; emailVerified: boolean };
};

type ErrorBody = {
  error?: string;
  code?: string;
};

type JsonResponse<T> = {
  status: number;
  body: T;
  rawBody: string;
};

describe.sequential("sapporta email verification policy - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-email-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAuthScopedTasksSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "auth_scoped_tasks");
    await assertSqliteTable(project, "user", ["id", "email", "emailVerified"]);
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

  it("allows local unverified sessions and enforces production verification", async () => {
    const localBaseUrl = server!.baseUrl;
    const cookieFile = cookieJar("verification-policy-user");
    const credentials = {
      name: "Verification Policy User",
      email: "verification-policy@example.test",
      password: "correct-horse-battery-staple",
      timeZone: "UTC",
    };

    await requestJson<unknown>(localBaseUrl, "/api/auth/sign-up/email", {
      cookieFile,
      method: "POST",
      body: credentials,
      expectedStatus: 200,
    });

    const localContext = await requestJson<AuthContextBody>(
      localBaseUrl,
      "/api/auth-context",
      { cookieFile, expectedStatus: 200 },
    );
    expect(localContext.body.user.email).toBe(credentials.email);
    expect(localContext.body.user.emailVerified).toBe(false);

    await requestJson<RowsBody>(localBaseUrl, "/api/tables/tasks", {
      cookieFile,
      expectedStatus: 200,
    });

    stopServer(server);
    server = await startBuiltServer(project!, {
      SAPPORTA_REQUIRE_VERIFIED_EMAIL: "true",
    });
    const requiredBaseUrl = server.baseUrl;

    const contextWhileUnverified = await requestJson<unknown>(
      requiredBaseUrl,
      "/api/auth-context",
      { cookieFile, expectedStatus: 403 },
    );
    expectHttpError(contextWhileUnverified, 403, {
      code: "email_not_verified",
      error: "Email verification required",
    });

    for (const path of ["/api/hello", "/api/tables/tasks"]) {
      const response = await requestJson<unknown>(requiredBaseUrl, path, {
        cookieFile,
        expectedStatus: 403,
      });
      expectHttpError(response, 403, {
        code: "email_not_verified",
        error: "Email verification required",
      });
    }

    const blockedSignin = await requestJson<BetterAuthErrorBody>(
      requiredBaseUrl,
      "/api/auth/sign-in/email",
      {
        cookieFile: cookieJar("verification-policy-signin"),
        method: "POST",
        body: {
          email: credentials.email,
          password: credentials.password,
        },
        expectedStatus: 403,
      },
    );
    expect(blockedSignin.body.code).toBe("EMAIL_NOT_VERIFIED");

    const resendKnown = await requestJson<StatusBody>(
      requiredBaseUrl,
      "/api/auth/send-verification-email",
      {
        method: "POST",
        body: { email: credentials.email },
        expectedStatus: 200,
      },
    );
    expect(resendKnown.body).toEqual({ status: true });

    const resendUnknown = await requestJson<StatusBody>(
      requiredBaseUrl,
      "/api/auth/send-verification-email",
      {
        method: "POST",
        body: { email: "unknown-verification@example.test" },
        expectedStatus: 200,
      },
    );
    expect(resendUnknown.body).toEqual({ status: true });

    const invalidVerification = await requestJson<BetterAuthErrorBody>(
      requiredBaseUrl,
      "/api/auth/verify-email?token=invalid-token",
      { expectedStatus: 401 },
    );
    expect(invalidVerification.body.code).toBe("INVALID_TOKEN");

    const resetRequest = await requestJson<StatusBody>(
      requiredBaseUrl,
      "/api/auth/request-password-reset",
      {
        method: "POST",
        body: { email: credentials.email },
        expectedStatus: 200,
      },
    );
    expect(resetRequest.body.status).toBe(true);

    for (const body of [
      { newPassword: "new-correct-horse-battery-staple" },
      {
        newPassword: "new-correct-horse-battery-staple",
        token: "invalid-token",
      },
    ]) {
      const resetFailure = await requestJson<BetterAuthErrorBody>(
        requiredBaseUrl,
        "/api/auth/reset-password",
        {
          method: "POST",
          body,
          expectedStatus: 400,
        },
      );
      expect(resetFailure.body.code).toBe("INVALID_TOKEN");
    }

    await runSqliteStatement(
      'UPDATE "user" SET "emailVerified" = 1 WHERE "email" = ?',
      [credentials.email],
    );

    const verifiedContext = await requestJson<AuthContextBody>(
      requiredBaseUrl,
      "/api/auth-context",
      { cookieFile, expectedStatus: 200 },
    );
    expect(verifiedContext.body.user.emailVerified).toBe(true);

    const verifiedRows = await requestJson<RowsBody>(
      requiredBaseUrl,
      "/api/tables/tasks",
      { cookieFile, expectedStatus: 200 },
    );
    expect(Array.isArray(verifiedRows.body.data)).toBe(true);
  });

  function cookieJar(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9_.-]+/g, "-");
    return join(project!.parentDir, `${safeName}.cookies.txt`);
  }

  async function requestJson<T>(
    baseUrl: string,
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      cookieFile?: string;
      expectedStatus?: number;
    } = {},
  ): Promise<JsonResponse<T>> {
    const args = ["-sS"];
    if (opts.cookieFile) {
      args.push("-b", opts.cookieFile, "-c", opts.cookieFile);
    }
    if (opts.method) {
      args.push("-X", opts.method);
    }
    if (opts.body !== undefined) {
      args.push("-H", "Content-Type: application/json");
      args.push("-H", `Origin: ${baseUrl}`);
      args.push("--data", JSON.stringify(opts.body));
    }
    args.push("-w", "\n%{http_code}", `${baseUrl}${path}`);
    const output = await runText("curl", args, {
      cwd: project!.projectDir,
      env: project!.env,
      timeoutMs: 30_000,
    });
    const separator = output.lastIndexOf("\n");
    const rawBody = separator === -1 ? output : output.slice(0, separator);
    const status = Number(separator === -1 ? "0" : output.slice(separator + 1));
    if (opts.expectedStatus !== undefined) {
      expect(status, rawBody).toBe(opts.expectedStatus);
    }
    return {
      status,
      body: JSON.parse(rawBody) as T,
      rawBody,
    };
  }

  async function runSqliteStatement(
    sql: string,
    params: readonly (string | number | boolean | null)[],
  ): Promise<void> {
    const databasePath = join(project!.projectDir, "data", "sqlite.db");
    const queryScript = [
      'import Database from "better-sqlite3";',
      `const db = new Database(${JSON.stringify(databasePath)});`,
      `db.prepare(${JSON.stringify(sql)}).run(...${JSON.stringify(params)});`,
      "db.close();",
    ].join("\n");
    await runText(
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
        cwd: project!.projectDir,
        env: project!.env,
        timeoutMs: 30_000,
      },
    );
  }

  function expectHttpError(
    response: JsonResponse<unknown>,
    expectedStatus: number,
    expected: { code: string; error: string },
  ): void {
    expect(response.status).toBe(expectedStatus);
    const body = response.body as ErrorBody;
    expect(body.code).toBe(expected.code);
    expect(body.error).toBe(expected.error);
  }
});
