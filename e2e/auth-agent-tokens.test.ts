import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addWorkspaceMember,
  assertBetterSqliteLoads,
  assertSqliteTable,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  expectHttpError,
  expectNoScopeLeak,
  parseJsonOutput,
  readProjectDevEnv,
  readSqliteRows,
  requestJson,
  runDrizzleMigrationCycle,
  runProjectCli,
  runSqliteStatement,
  scaffoldProject,
  signInEmailUser,
  signUpEmailUser,
  startBuiltServer,
  stopServer,
  writeProjectApiPort,
  type CommandResult,
  type E2eProject,
  type JsonRequestOptions,
  type JsonResponse,
  type StartedServer,
} from "./harness.js";

const PASSWORD = "correct-horse-battery-staple";

/**
 * `spat_<token-id>_<secret>`: the id selects one stored row and the secret is
 * compared against its hash. Splitting the two is what lets the server find a
 * token without storing the credential, so the shape is part of the contract.
 */
const RAW_TOKEN_PATTERN = /^spat_([0-9a-f-]{36})_([A-Za-z0-9_-]+)$/;

type ErrorBody = {
  error?: string;
  code?: string;
  details?: unknown;
};

type AuthContextBody = {
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

type AuthTokenBody = {
  id: string;
  userId: string;
  organizationId: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type CreateAuthTokenBody = {
  token: AuthTokenBody;
  rawToken: string;
};

type AuthTokenListBody = {
  tokens: AuthTokenBody[];
};

type TaskRow = {
  id: number;
  title: string;
  status: "todo" | "in_progress" | "done";
  priority: number;
  workspace_id: string;
};

type NoteRow = {
  id: number;
  title: string;
  body: string;
  workspace_id: string;
  scoped_to_user_id: string;
};

type ListBody<T> = {
  data: T[];
  meta: { total: number; page: number; limit: number; pages: number };
};

type RowBody<T> = {
  data: T;
};

type CountBody = {
  data: { kind: "total"; count: number };
};

type EndpointRow = {
  method: string;
  path: string;
};

/**
 * What the CLI prints on stdout when a command fails under `--output json`.
 *
 * `target` appears only when the failure leaves the deployment in question,
 * which is exactly the case an absent token produces. `apiUrlSource` reports
 * which setting chose the URL.
 */
type CliErrorEnvelope = {
  ok: false;
  error: string;
  code: string;
  target?: {
    requestUrl: string;
    apiUrl: string;
    apiUrlSource: "flag" | "env" | "project" | "default";
    apiTokenSource: "flag" | "env" | "none";
  };
};

type SignedUser = {
  email: string;
  cookieFile: string;
  context: AuthContextBody;
};

/** One user, one workspace, and the raw credential that carries both. */
type AgentToken = {
  raw: string;
  id: string;
  userId: string;
  workspaceId: string;
};

type TokenWorld = {
  owner: SignedUser;
  teammate: SignedUser;
  workspaceA: string;
  workspaceB: string;
  tokenA: AgentToken;
  tokenB: AgentToken;
  tokenTeammate: AgentToken;
  taskA: TaskRow;
  taskB: TaskRow;
  taskTeammate: TaskRow;
  noteOwner: NoteRow;
  noteTeammate: NoteRow;
};

/**
 * Two row scopes are enough to tell a token's authority apart from a session's.
 *
 * `tasks` is workspace-global, so it separates one workspace from another.
 * `notes` is scoped to a user within a workspace, so it separates two people
 * who are both members of the same workspace.
 */
function writeAgentTokenSchema(projectDir: string): void {
  const schemaDir = join(projectDir, "packages", "api", "schema");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(
    join(schemaDir, "agent_token_matrix.ts"),
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
      '    search: { self: ["title", "status"] },',
      "  },",
      "});",
      "",
      'export const notesTable = sqliteTable("notes", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  body: text("body").notNull(),',
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
      '    search: { self: ["title", "body"] },',
      "  },",
      "});",
      "",
    ].join("\n"),
  );
}

describe.sequential("generated app agent access tokens - end-to-end", () => {
  let project: E2eProject | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-agent-token-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAgentTokenSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "agent_token_matrix");
    await assertSqliteTable(project, "personalAccessToken", [
      "id",
      "userId",
      "organizationId",
      "name",
      "secretHash",
      "createdAt",
      "expiresAt",
      "lastUsedAt",
      "revokedAt",
    ]);
    await assertSqliteTable(project, "tasks", [
      "id",
      "title",
      "status",
      "priority",
      "workspace_id",
    ]);
    await assertSqliteTable(project, "notes", [
      "id",
      "title",
      "body",
      "workspace_id",
      "scoped_to_user_id",
    ]);
    await buildGeneratedProject(project);
  }, 420_000);

  afterAll(() => {
    cleanupProject(project);
  });

  describe.sequential("against a development server", () => {
    let server: StartedServer | undefined;
    let world: TokenWorld | undefined;

    beforeAll(async () => {
      // `.env.development` sets this policy, so a development server is the
      // deployment shape where endpoint discovery answers anonymously.
      server = await startBuiltServer(project!, {
        SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
        SAPPORTA_OPENAPI_POLICY: "public",
      });
      writeProjectApiPort(project!, server.baseUrl);
      world = await buildTokenWorld();
    }, 180_000);

    afterAll(() => {
      stopServer(server);
      server = undefined;
    });

    it("binds a new token to the workspace the browser session was in", async () => {
      const { owner, workspaceA, workspaceB, tokenA, tokenB } = world!;

      expect(tokenA.workspaceId).toBe(workspaceA);
      expect(tokenB.workspaceId).toBe(workspaceB);
      expect(tokenA.userId).toBe(owner.context.user.id);
      expect(tokenB.userId).toBe(owner.context.user.id);

      const parsed = RAW_TOKEN_PATTERN.exec(tokenA.raw);
      expect(parsed, `Unexpected token format: ${tokenA.raw}`).not.toBeNull();
      expect(parsed![1]).toBe(tokenA.id);

      // The session is in workspace A, so a route that reports who the caller
      // is has to disagree with the session for the workspace-B token.
      const sessionContext = await authContext(owner.cookieFile);
      expect(sessionContext.workspace.id).toBe(workspaceA);

      const throughTokenA = await bearerJson<AuthContextBody>(
        tokenA,
        "/api/auth-context",
        { expectedStatus: 200 },
      );
      expect(throughTokenA.body.user.id).toBe(owner.context.user.id);
      expect(throughTokenA.body.workspace.id).toBe(workspaceA);

      const throughTokenB = await bearerJson<AuthContextBody>(
        tokenB,
        "/api/auth-context",
        { expectedStatus: 200 },
      );
      expect(throughTokenB.body.user.id).toBe(owner.context.user.id);
      expect(throughTokenB.body.workspace.id).toBe(workspaceB);
    });

    it("returns the raw token once and metadata afterwards", async () => {
      const { owner, workspaceA, tokenA } = world!;

      const listed = await requestJson<AuthTokenListBody>(
        server!.baseUrl,
        "/api/auth-tokens",
        {
          cookieFile: owner.cookieFile,
          expectedStatus: 200,
          serverOutput: server!.output,
        },
      );

      const metadata = listed.body.tokens.find(
        (token) => token.id === tokenA.id,
      );
      expect(metadata).toBeDefined();
      expect(metadata!.organizationId).toBe(workspaceA);
      expect(metadata).not.toHaveProperty("rawToken");
      expect(metadata).not.toHaveProperty("secretHash");
      expect(listed.rawBody).not.toContain(tokenA.raw);

      // The listing is scoped to the session's workspace, so the workspace-B
      // token is absent while the session is in workspace A.
      expect(
        listed.body.tokens.every(
          (token) => token.organizationId === workspaceA,
        ),
      ).toBe(true);

      // The database keeps a hash of the secret, so a copy of the project's
      // data does not hand anyone a working credential.
      const secret = RAW_TOKEN_PATTERN.exec(tokenA.raw)![2];
      const stored = await readSqliteRows<{ secretHash: string }>(
        project!,
        "SELECT secretHash FROM personalAccessToken WHERE id = ?",
        [tokenA.id],
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].secretHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[0].secretHash).not.toContain(secret);
    });

    it("refuses to mint a token for a workspace the session is not in", async () => {
      const { owner, workspaceA, workspaceB } = world!;

      const context = await authContext(owner.cookieFile);
      expect(context.workspace.id).toBe(workspaceA);

      const crossWorkspace = await requestJson<ErrorBody>(
        server!.baseUrl,
        "/api/auth-tokens",
        {
          cookieFile: owner.cookieFile,
          method: "POST",
          body: { name: "agent-cross-workspace", organizationId: workspaceB },
          expectedStatus: 403,
          serverOutput: server!.output,
        },
      );
      expectHttpError(crossWorkspace, 403, { code: "forbidden" });

      const created = await readSqliteRows<{ count: number }>(
        project!,
        "SELECT COUNT(*) AS count FROM personalAccessToken WHERE name = ?",
        ["agent-cross-workspace"],
      );
      expect(created[0].count).toBe(0);
    });

    it("keeps token management an interactive browser action", async () => {
      const { owner, tokenA, tokenB, workspaceA, workspaceB } = world!;

      const listed = await bearerJson<ErrorBody>(tokenA, "/api/auth-tokens", {
        expectedStatus: 403,
      });
      expectHttpError(listed, 403, { code: "forbidden" });

      const minted = await bearerJson<ErrorBody>(tokenA, "/api/auth-tokens", {
        method: "POST",
        body: { name: "self-minted" },
        expectedStatus: 403,
      });
      expectHttpError(minted, 403, { code: "forbidden" });

      const revoked = await bearerJson<ErrorBody>(
        tokenA,
        `/api/auth-tokens/${tokenB.id}`,
        { method: "DELETE", expectedStatus: 403 },
      );
      expectHttpError(revoked, 403, { code: "forbidden" });

      // A browser session reaches only the tokens of the workspace it is in.
      // The workspace-B token is not the session's to revoke from workspace A,
      // and the reply says so without confirming that the id exists.
      const context = await authContext(owner.cookieFile);
      expect(context.workspace.id).toBe(workspaceA);
      const outOfScope = await requestJson<ErrorBody>(
        server!.baseUrl,
        `/api/auth-tokens/${tokenB.id}`,
        {
          cookieFile: owner.cookieFile,
          method: "DELETE",
          expectedStatus: 404,
          serverOutput: server!.output,
        },
      );
      expectHttpError(outOfScope, 404, { code: "not_found" });

      const stillValid = await bearerJson<AuthContextBody>(
        tokenB,
        "/api/auth-context",
        { expectedStatus: 200 },
      );
      expect(stillValid.body.workspace.id).toBe(workspaceB);
    });

    it("cannot be widened by a query parameter, request body, or workspace_id field", async () => {
      const { tokenA, tokenB, workspaceA, workspaceB, taskA, taskB } = world!;

      // A workspace named in the query string is not a recognised list
      // parameter, so it never reaches row selection at all.
      for (const parameter of ["workspace_id", "workspaceId"]) {
        const named = await bearerJson<ErrorBody>(
          tokenA,
          `/api/tables/tasks?${parameter}=${workspaceB}`,
          { expectedStatus: 400 },
        );
        expect(named.body.code).toBe("bad_value");
      }

      // The supported filter grammar does reach row selection, and there it
      // narrows within the token's workspace rather than replacing it.
      const filteredToOtherWorkspace = await bearerJson<ListBody<TaskRow>>(
        tokenA,
        `/api/tables/tasks?filter%5Bworkspace_id%5D%5Beq%5D=${workspaceB}`,
        { expectedStatus: 200 },
      );
      expect(filteredToOtherWorkspace.body.data).toEqual([]);

      const filteredToOwnWorkspace = await bearerJson<ListBody<TaskRow>>(
        tokenA,
        `/api/tables/tasks?filter%5Bworkspace_id%5D%5Beq%5D=${workspaceA}`,
        { expectedStatus: 200 },
      );
      expect(filteredToOwnWorkspace.body.data.map((row) => row.id)).toContain(
        taskA.id,
      );

      const submittedScope = await bearerJson<ErrorBody>(
        tokenA,
        "/api/tables/tasks",
        {
          method: "POST",
          body: {
            title: "A smuggled",
            status: "todo",
            priority: 3,
            workspace_id: workspaceB,
          },
          expectedStatus: 422,
        },
      );
      expect(submittedScope.body.code).toBe("VALIDATION_FAILED");

      // A row id from the other workspace is not a way around the boundary
      // either: reads and writes both answer as though the row is absent.
      const readOther = await bearerJson<ErrorBody>(
        tokenA,
        `/api/tables/tasks/${taskB.id}`,
        { expectedStatus: 404 },
      );
      expect(readOther.body.code).toBe("ROW_NOT_FOUND");

      const updateOther = await bearerJson<ErrorBody>(
        tokenA,
        `/api/tables/tasks/${taskB.id}`,
        {
          method: "PUT",
          body: { title: "hijacked" },
          expectedStatus: 404,
        },
      );
      expect(updateOther.body.code).toBe("ROW_NOT_FOUND");

      const deleteOther = await bearerJson<ErrorBody>(
        tokenA,
        `/api/tables/tasks/${taskB.id}`,
        { method: "DELETE", expectedStatus: 404 },
      );
      expect(deleteOther.body.code).toBe("ROW_NOT_FOUND");

      const untouched = await bearerJson<RowBody<TaskRow>>(
        tokenB,
        `/api/tables/tasks/${taskB.id}`,
        { expectedStatus: 200 },
      );
      expect(untouched.body.data.title).toBe(taskB.title);
    });

    it("reads and writes over HTTP with the bearer token and refuses without it", async () => {
      const { tokenA, workspaceA, taskA } = world!;

      for (const anonymous of [
        await requestJson<ErrorBody>(server!.baseUrl, "/api/tables/tasks", {
          expectedStatus: 401,
          serverOutput: server!.output,
        }),
        await requestJson<ErrorBody>(
          server!.baseUrl,
          `/api/tables/tasks/${taskA.id}`,
          { expectedStatus: 401, serverOutput: server!.output },
        ),
        await requestJson<ErrorBody>(server!.baseUrl, "/api/tables/tasks", {
          method: "POST",
          body: { title: "anonymous", status: "todo", priority: 1 },
          expectedStatus: 401,
          serverOutput: server!.output,
        }),
        await requestJson<ErrorBody>(
          server!.baseUrl,
          `/api/tables/tasks/${taskA.id}`,
          {
            method: "PUT",
            body: { title: "anonymous" },
            expectedStatus: 401,
            serverOutput: server!.output,
          },
        ),
        await requestJson<ErrorBody>(
          server!.baseUrl,
          `/api/tables/tasks/${taskA.id}`,
          {
            method: "DELETE",
            expectedStatus: 401,
            serverOutput: server!.output,
          },
        ),
      ]) {
        expectHttpError(anonymous, 401, { code: "unauthenticated" });
      }

      const created = await bearerJson<RowBody<TaskRow>>(
        tokenA,
        "/api/tables/tasks",
        {
          method: "POST",
          body: { title: "A http round trip", status: "todo", priority: 5 },
          expectedStatus: 201,
        },
      );
      expect(created.body.data.workspace_id).toBe(workspaceA);

      const read = await bearerJson<RowBody<TaskRow>>(
        tokenA,
        `/api/tables/tasks/${created.body.data.id}`,
        { expectedStatus: 200 },
      );
      expect(read.body.data.title).toBe("A http round trip");

      const updated = await bearerJson<RowBody<TaskRow>>(
        tokenA,
        `/api/tables/tasks/${created.body.data.id}`,
        {
          method: "PUT",
          body: { status: "done" },
          expectedStatus: 200,
        },
      );
      expect(updated.body.data.status).toBe("done");

      const removed = await bearerJson<RowBody<TaskRow>>(
        tokenA,
        `/api/tables/tasks/${created.body.data.id}`,
        { method: "DELETE", expectedStatus: 200 },
      );
      expect(removed.body.data.id).toBe(created.body.data.id);

      const afterDelete = await bearerJson<ErrorBody>(
        tokenA,
        `/api/tables/tasks/${created.body.data.id}`,
        { expectedStatus: 404 },
      );
      expect(afterDelete.body.code).toBe("ROW_NOT_FOUND");
    });

    it("runs authenticated CLI reads and writes, and names the missing token", async () => {
      const { tokenA, tokenB, workspaceA } = world!;

      const withoutToken = await runProjectCli(project!, [
        "rows",
        "list",
        "tasks",
      ]);
      expect(withoutToken.code).toBe(1);
      const failure = parseJsonOutput<CliErrorEnvelope>(withoutToken.output);
      expect(failure.ok).toBe(false);
      expect(failure.code).toBe("unauthenticated");
      // The CLI found this project's API without `--api-url`, which is the
      // whole point of recording the port in `.env.development`.
      expect(failure.target?.apiUrlSource).toBe("project");
      expect(failure.target?.apiTokenSource).toBe("none");
      expect(failure.target?.apiUrl).toBe(
        `http://localhost:${new URL(server!.baseUrl).port}`,
      );

      const created = expectCliSuccess<RowBody<TaskRow>>(
        await runProjectCli(
          project!,
          [
            "rows",
            "create",
            "tasks",
            "--values",
            JSON.stringify({
              title: "A cli delta",
              status: "todo",
              priority: 7,
            }),
          ],
          { apiToken: tokenA.raw },
        ),
      );
      expect(created.data.workspace_id).toBe(workspaceA);

      const listed = expectCliSuccess<ListBody<TaskRow>>(
        await runProjectCli(project!, ["rows", "list", "tasks"], {
          apiToken: tokenA.raw,
        }),
      );
      expect(listed.data.map((row) => row.title)).toContain("A cli delta");
      expectNoScopeLeak(listed.data, { workspaceId: workspaceA });

      // `api get '/api/auth-context'` is the check the account page's setup
      // prompt hands to an agent: it answers with the identity the token acts
      // as, so it fails when the token was never wired into the CLI. Both
      // directions matter, because `endpoints list` passes either way here and
      // is what makes a weaker check look like a working one.
      const identity = expectCliSuccess<AuthContextBody>(
        await runProjectCli(project!, ["api", "get", "/api/auth-context"], {
          apiToken: tokenB.raw,
        }),
      );
      expect(identity.workspace.id).toBe(world!.workspaceB);

      const identityWithoutToken = await runProjectCli(project!, [
        "api",
        "get",
        "/api/auth-context",
      ]);
      expect(identityWithoutToken.code).toBe(1);
      expect(
        parseJsonOutput<CliErrorEnvelope>(identityWithoutToken.output).code,
      ).toBe("unauthenticated");

      const countedInB = expectCliSuccess<CountBody>(
        await runProjectCli(project!, ["rows", "count", "tasks"], {
          apiToken: tokenB.raw,
        }),
      );
      expect(countedInB.data.kind).toBe("total");
      // The same command under a different token counts a different set of
      // rows, without either invocation naming a workspace.
      expect(countedInB.data.count).toBe(1);
      expect(listed.data.length).toBeGreaterThan(countedInB.data.count);

      const deleted = await runProjectCli(
        project!,
        ["rows", "delete", "tasks", String(created.data.id)],
        { apiToken: tokenA.raw },
      );
      expect(deleted.code).toBe(0);
    }, 120_000);

    it("distinguishes the documented token failures", async () => {
      const { owner, tokenA } = world!;

      for (const authorization of [
        "Bearer spat_00000000-0000-0000-0000-000000000000_not-a-real-secret",
        "Bearer not-a-sapporta-token",
        `Bearer ${tokenA.raw}-tampered`,
      ]) {
        const rejected = await requestJson<ErrorBody>(
          server!.baseUrl,
          "/api/tables/tasks",
          {
            headers: { authorization },
            expectedStatus: 401,
            serverOutput: server!.output,
          },
        );
        expectHttpError(rejected, 401, { code: "unauthenticated" });
      }

      const noCredential = await requestJson<ErrorBody>(
        server!.baseUrl,
        "/api/tables/tasks",
        { expectedStatus: 401, serverOutput: server!.output },
      );
      expectHttpError(noCredential, 401, { code: "unauthenticated" });

      const expired = await mintToken(owner.cookieFile, "agent-expired", {
        expiresAt: "2020-01-01T00:00:00.000Z",
      });
      const expiredCall = await bearerJson<ErrorBody>(
        expired,
        "/api/tables/tasks",
        { expectedStatus: 401 },
      );
      expectHttpError(expiredCall, 401, { code: "token_expired" });

      const revocable = await mintToken(owner.cookieFile, "agent-revoked");
      await requestJson<unknown>(
        server!.baseUrl,
        `/api/auth-tokens/${revocable.id}`,
        {
          cookieFile: owner.cookieFile,
          method: "DELETE",
          expectedStatus: 204,
          serverOutput: server!.output,
        },
      );
      const revokedCall = await bearerJson<ErrorBody>(
        revocable,
        "/api/tables/tasks",
        { expectedStatus: 401 },
      );
      expectHttpError(revokedCall, 401, { code: "token_revoked" });

      // A token names a workspace the user has to still belong to. Dropping
      // the membership is the recoverable branch: the credential itself is
      // intact, so the reply is neither `unauthenticated` nor `token_revoked`.
      const contractor = await createSignedUser("contractor");
      await addWorkspaceMember(project!, {
        workspaceId: world!.workspaceA,
        userId: contractor.context.user.id,
        role: "member",
      });
      await switchWorkspace(contractor.cookieFile, world!.workspaceA);
      const contractorToken = await mintToken(
        contractor.cookieFile,
        "agent-contractor",
      );
      const beforeRemoval = await bearerJson<AuthContextBody>(
        contractorToken,
        "/api/auth-context",
        { expectedStatus: 200 },
      );
      expect(beforeRemoval.body.workspace.id).toBe(world!.workspaceA);

      const lastAcceptedUse = Date.now();
      await runSqliteStatement(
        project!,
        "DELETE FROM member WHERE userId = ? AND organizationId = ?",
        [contractor.context.user.id, world!.workspaceA],
      );

      const afterRemoval = await bearerJson<ErrorBody>(
        contractorToken,
        "/api/auth-context",
        { expectedStatus: 403 },
      );
      expectHttpError(afterRemoval, 403, { code: "workspace_required" });

      const afterRemovalRows = await bearerJson<ErrorBody>(
        contractorToken,
        "/api/tables/tasks",
        { expectedStatus: 403 },
      );
      expectHttpError(afterRemovalRows, 403, { code: "workspace_required" });

      // Each failing branch stops before the token is marked as used, so a
      // rejected call leaves no trace that would read as a successful one.
      const useTimes = await readSqliteRows<{
        id: string;
        lastUsedAt: number | null;
      }>(
        project!,
        "SELECT id, lastUsedAt FROM personalAccessToken WHERE id IN (?, ?, ?, ?)",
        [expired.id, revocable.id, contractorToken.id, tokenA.id],
      );
      const lastUsed = new Map(useTimes.map((row) => [row.id, row.lastUsedAt]));
      expect(lastUsed.get(expired.id)).toBeNull();
      expect(lastUsed.get(revocable.id)).toBeNull();
      expect(lastUsed.get(tokenA.id)).not.toBeNull();
      // The contractor's token was accepted once, before the membership went
      // away; the calls rejected after it did not move the timestamp forward.
      const contractorLastUsed = lastUsed.get(contractorToken.id);
      expect(contractorLastUsed).not.toBeNull();
      expect(contractorLastUsed!).toBeLessThanOrEqual(lastAcceptedUse);
    }, 120_000);

    it("shows rows for the token's workspace and user, not the session's active workspace", async () => {
      const {
        owner,
        teammate,
        workspaceA,
        workspaceB,
        tokenA,
        tokenB,
        tokenTeammate,
        taskA,
        taskB,
        taskTeammate,
        noteOwner,
        noteTeammate,
      } = world!;

      // Move the browser session somewhere else entirely. Nothing a token
      // reads afterwards may follow it.
      const movedSession = await switchWorkspace(owner.cookieFile, workspaceB);
      expect(movedSession.workspace.id).toBe(workspaceB);

      const tasksThroughA = await bearerJson<ListBody<TaskRow>>(
        tokenA,
        "/api/tables/tasks",
        { expectedStatus: 200 },
      );
      expectNoScopeLeak(tasksThroughA.body.data, { workspaceId: workspaceA });
      const idsThroughA = tasksThroughA.body.data.map((row) => row.id);
      expect(idsThroughA).toContain(taskA.id);
      // A workspace-global table shows a teammate's rows to every member.
      expect(idsThroughA).toContain(taskTeammate.id);
      expect(idsThroughA).not.toContain(taskB.id);

      const tasksThroughB = await bearerJson<ListBody<TaskRow>>(
        tokenB,
        "/api/tables/tasks",
        { expectedStatus: 200 },
      );
      expectNoScopeLeak(tasksThroughB.body.data, { workspaceId: workspaceB });
      expect(tasksThroughB.body.data.map((row) => row.id)).toEqual([taskB.id]);

      // Both people are members of workspace A, so a user-scoped table is what
      // separates them, and the token says which of them is calling.
      const notesThroughA = await bearerJson<ListBody<NoteRow>>(
        tokenA,
        "/api/tables/notes",
        { expectedStatus: 200 },
      );
      expectNoScopeLeak(notesThroughA.body.data, {
        workspaceId: workspaceA,
        scopedToUserId: owner.context.user.id,
      });
      expect(notesThroughA.body.data.map((row) => row.id)).toEqual([
        noteOwner.id,
      ]);

      const notesThroughTeammate = await bearerJson<ListBody<NoteRow>>(
        tokenTeammate,
        "/api/tables/notes",
        { expectedStatus: 200 },
      );
      expectNoScopeLeak(notesThroughTeammate.body.data, {
        workspaceId: workspaceA,
        scopedToUserId: teammate.context.user.id,
      });
      expect(notesThroughTeammate.body.data.map((row) => row.id)).toEqual([
        noteTeammate.id,
      ]);

      const otherUsersNote = await bearerJson<ErrorBody>(
        tokenA,
        `/api/tables/notes/${noteTeammate.id}`,
        { expectedStatus: 404 },
      );
      expect(otherUsersNote.body.code).toBe("ROW_NOT_FOUND");

      // The session is still in workspace B; the browser sees B while the
      // workspace-A token kept reading A throughout.
      const sessionRows = await requestJson<ListBody<TaskRow>>(
        server!.baseUrl,
        "/api/tables/tasks",
        {
          cookieFile: owner.cookieFile,
          expectedStatus: 200,
          serverOutput: server!.output,
        },
      );
      expectNoScopeLeak(sessionRows.body.data, { workspaceId: workspaceB });

      await switchWorkspace(owner.cookieFile, workspaceA);
    });

    it("answers endpoint discovery without a credential under the public policy", async () => {
      // The generated development environment is what makes this reachable.
      expect(readProjectDevEnv(project!)).toMatch(
        /^SAPPORTA_OPENAPI_POLICY=public$/m,
      );

      const contract = await requestJson<{
        openapi: string;
        paths: Record<string, unknown>;
      }>(server!.baseUrl, "/api/openapi.json", {
        expectedStatus: 200,
        serverOutput: server!.output,
      });
      expect(contract.body.openapi).toMatch(/^3\./);
      expect(Object.keys(contract.body.paths)).toContain("/api/tables/tasks");

      const endpoints = expectCliSuccess<EndpointRow[]>(
        await runProjectCli(project!, ["endpoints", "list"]),
      );
      expect(
        endpoints.some(
          (endpoint) =>
            endpoint.method === "GET" && endpoint.path === "/api/tables/tasks",
        ),
      ).toBe(true);

      // Discovery describes the app; it does not hand out its data.
      const rows = await requestJson<ErrorBody>(
        server!.baseUrl,
        "/api/tables/tasks",
        { expectedStatus: 401, serverOutput: server!.output },
      );
      expectHttpError(rows, 401, { code: "unauthenticated" });
    }, 60_000);

    async function buildTokenWorld(): Promise<TokenWorld> {
      const owner = await createSignedUser("owner");
      const workspaceA = owner.context.workspace.id;

      const workspaceB = await createWorkspace(
        owner.cookieFile,
        "Second Workspace",
      );
      expect(workspaceB).not.toBe(workspaceA);
      // Creating a workspace makes it the session's active one, so this token
      // is minted from a session sitting in workspace B.
      const tokenB = await mintToken(owner.cookieFile, "agent-workspace-b");

      await switchWorkspace(owner.cookieFile, workspaceA);
      const tokenA = await mintToken(owner.cookieFile, "agent-workspace-a");

      const teammate = await createSignedUser("teammate");
      await addWorkspaceMember(project!, {
        workspaceId: workspaceA,
        userId: teammate.context.user.id,
        role: "owner",
      });
      await switchWorkspace(teammate.cookieFile, workspaceA);
      const tokenTeammate = await mintToken(
        teammate.cookieFile,
        "agent-teammate",
      );

      const taskA = await createTask(tokenA, "A alpha", 1);
      const taskB = await createTask(tokenB, "B gamma", 2);
      const taskTeammate = await createTask(tokenTeammate, "A teammate", 4);
      const noteOwner = await createNote(tokenA, "owner note");
      const noteTeammate = await createNote(tokenTeammate, "teammate note");

      return {
        owner,
        teammate,
        workspaceA,
        workspaceB,
        tokenA,
        tokenB,
        tokenTeammate,
        taskA,
        taskB,
        taskTeammate,
        noteOwner,
        noteTeammate,
      };
    }

    async function createSignedUser(label: string): Promise<SignedUser> {
      const email = `${label}-${Date.now()}@example.test`;
      const signedUp = await signUpEmailUser(project!, server!.baseUrl, {
        email,
        password: PASSWORD,
        name: label,
      });
      const signedIn = await signInEmailUser(
        project!,
        server!.baseUrl,
        signedUp,
      );
      const context = await authContext(signedIn.cookieFile);
      expect(context.user.email).toBe(email);
      return { email, cookieFile: signedIn.cookieFile, context };
    }

    async function authContext(cookieFile: string): Promise<AuthContextBody> {
      const response = await requestJson<AuthContextBody>(
        server!.baseUrl,
        "/api/auth-context",
        {
          cookieFile,
          expectedStatus: 200,
          serverOutput: server!.output,
        },
      );
      return response.body;
    }

    async function createWorkspace(
      cookieFile: string,
      name: string,
    ): Promise<string> {
      await requestJson<unknown>(
        server!.baseUrl,
        "/api/auth/organization/create",
        {
          cookieFile,
          method: "POST",
          body: { name, slug: `second-${Date.now()}` },
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      );
      return (await authContext(cookieFile)).workspace.id;
    }

    async function switchWorkspace(
      cookieFile: string,
      workspaceId: string,
    ): Promise<AuthContextBody> {
      const response = await requestJson<AuthContextBody>(
        server!.baseUrl,
        "/api/auth-context/active-workspace",
        {
          cookieFile,
          method: "POST",
          body: { workspaceId },
          expectedStatus: 200,
          serverOutput: server!.output,
        },
      );
      expect(response.body.workspace.id).toBe(workspaceId);
      return response.body;
    }

    async function mintToken(
      cookieFile: string,
      name: string,
      extra: { expiresAt?: string } = {},
    ): Promise<AgentToken> {
      const response = await requestJson<CreateAuthTokenBody>(
        server!.baseUrl,
        "/api/auth-tokens",
        {
          cookieFile,
          method: "POST",
          body: { name, ...extra },
          expectedStatus: 201,
          serverOutput: server!.output,
        },
      );
      return {
        raw: response.body.rawToken,
        id: response.body.token.id,
        userId: response.body.token.userId,
        workspaceId: response.body.token.organizationId,
      };
    }

    async function createTask(
      token: AgentToken,
      title: string,
      priority: number,
    ): Promise<TaskRow> {
      const response = await bearerJson<RowBody<TaskRow>>(
        token,
        "/api/tables/tasks",
        {
          method: "POST",
          body: { title, status: "todo", priority },
          expectedStatus: 201,
        },
      );
      return response.body.data;
    }

    async function createNote(
      token: AgentToken,
      title: string,
    ): Promise<NoteRow> {
      const response = await bearerJson<RowBody<NoteRow>>(
        token,
        "/api/tables/notes",
        {
          method: "POST",
          body: { title, body: `${title} body` },
          expectedStatus: 201,
        },
      );
      return response.body.data;
    }

    function bearerJson<T>(
      token: AgentToken | { raw: string },
      path: string,
      opts: JsonRequestOptions = {},
    ): Promise<JsonResponse<T>> {
      return requestJson<T>(server!.baseUrl, path, {
        ...opts,
        headers: {
          ...opts.headers,
          authorization: `Bearer ${token.raw}`,
        },
        serverOutput: opts.serverOutput ?? server!.output,
      });
    }
  });

  describe.sequential("with the app contract behind sign-in", () => {
    let server: StartedServer | undefined;
    let token: string | undefined;

    beforeAll(async () => {
      server = await startBuiltServer(project!, {
        SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
        SAPPORTA_OPENAPI_POLICY: "authenticated",
      });
      writeProjectApiPort(project!, server.baseUrl);

      const email = `discovery-${Date.now()}@example.test`;
      const signedUp = await signUpEmailUser(project!, server.baseUrl, {
        email,
        password: PASSWORD,
        name: "discovery",
      });
      const signedIn = await signInEmailUser(
        project!,
        server.baseUrl,
        signedUp,
      );
      const created = await requestJson<CreateAuthTokenBody>(
        server.baseUrl,
        "/api/auth-tokens",
        {
          cookieFile: signedIn.cookieFile,
          method: "POST",
          body: { name: "agent-discovery" },
          expectedStatus: 201,
          serverOutput: server.output,
        },
      );
      token = created.body.rawToken;
    }, 180_000);

    afterAll(() => {
      stopServer(server);
      server = undefined;
    });

    it("requires a token for endpoint discovery", async () => {
      const anonymous = await requestJson<ErrorBody>(
        server!.baseUrl,
        "/api/openapi.json",
        { expectedStatus: 401, serverOutput: server!.output },
      );
      expectHttpError(anonymous, 401, { code: "unauthenticated" });

      const credentialed = await requestJson<{ openapi: string }>(
        server!.baseUrl,
        "/api/openapi.json",
        {
          headers: { authorization: `Bearer ${token!}` },
          expectedStatus: 200,
          serverOutput: server!.output,
        },
      );
      expect(credentialed.body.openapi).toMatch(/^3\./);

      const withoutToken = await runProjectCli(project!, ["endpoints", "list"]);
      expect(withoutToken.code).toBe(1);
      const failure = parseJsonOutput<CliErrorEnvelope>(withoutToken.output);
      expect(failure.code).toBe("unauthenticated");
      expect(failure.target?.requestUrl).toContain("/api/openapi.json");

      const endpoints = expectCliSuccess<EndpointRow[]>(
        await runProjectCli(project!, ["endpoints", "list"], {
          apiToken: token!,
        }),
      );
      expect(
        endpoints.some((endpoint) => endpoint.path === "/api/tables/tasks"),
      ).toBe(true);
    }, 60_000);
  });
});

/**
 * Read the payload of a CLI command that was expected to succeed.
 *
 * `--output json` prints the API response itself on success and an `ok: false`
 * envelope on failure, so a failure is reported here with the command's own
 * output rather than as a type error further down.
 */
function expectCliSuccess<T>(result: CommandResult): T {
  expect(
    result.code,
    `Expected the CLI command to succeed. Output:\n${result.output}`,
  ).toBe(0);
  return parseJsonOutput<T>(result.output);
}
