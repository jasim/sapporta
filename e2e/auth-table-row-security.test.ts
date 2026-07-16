import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type E2eProject,
  type StartedServer,
  assertBetterSqliteLoads,
  assertSqliteTable,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  parseJsonOutput,
  runText,
  runDrizzleMigrationCycle,
  scaffoldProject,
  startBuiltServer,
  stopServer,
} from "./harness.js";

type AuthContextBody = {
  user: { id: string; email: string };
  workspace: { id: string; name: string; slug: string; isOwner?: boolean };
  memberships: Array<{
    workspace: { id: string; name: string; slug: string };
    role: string;
    isOwner: boolean;
  }>;
  role?: string;
  isOwner?: boolean;
};

type ErrorBody = {
  error?: string;
  code?: string;
  details?: unknown;
};

type ListBody<T> = {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
};

type RowBody<T> = {
  data: T;
};

type LookupBody = {
  entries: Array<{
    value: string | number;
    label: string;
  }>;
};

type CountBody = {
  data: Record<string, number>;
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
  category: "personal" | "shared" | "archive";
  workspace_id: string;
  scoped_to_user_id: string;
};

type SignedUser = {
  email: string;
  password: string;
  cookieFile: string;
  context: AuthContextBody;
};

const PASSWORD = "correct-horse-battery-staple";

type JsonRequestOptions = {
  method?: string;
  body?: unknown;
  cookieFile?: string;
  expectedStatus?: number;
  expectedSuccess?: boolean;
  serverOutput?: readonly string[];
};

type JsonResponse<T> = {
  status: number;
  body: T;
  rawBody: string;
};

type SignedInEmailUser = {
  email: string;
  password: string;
  cookieFile: string;
};

function writeAuthMatrixSchema(projectDir: string): void {
  const schemaDir = join(projectDir, "packages", "api", "schema");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(
    join(schemaDir, "auth_matrix.ts"),
    [
      'import { sapportaTable, sqliteTable, text, integer } from "@sapporta/server/table";',
      "",
      'export const tasksTable = sqliteTable("tasks", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  status: text("status").notNull(),',
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
      "    selects: [",
      '      { type: "select", column: "status", options: ["todo", "in_progress", "done"] },',
      "    ],",
      "  },",
      "});",
      "",
      'export const notesTable = sqliteTable("notes", {',
      '  id: integer("id").primaryKey({ autoIncrement: true }),',
      '  title: text("title").notNull(),',
      '  body: text("body").notNull(),',
      '  category: text("category").notNull(),',
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
      "    selects: [",
      '      { type: "select", column: "category", options: ["personal", "shared", "archive"] },',
      "    ],",
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
    ].join("\n"),
  );
}

function patchAuthMatrixAbility(projectDir: string): void {
  writeFileSync(
    join(projectDir, "packages", "api", "authz", "ability.ts"),
    [
      'import { AbilityBuilder, createMongoAbility } from "@casl/ability";',
      'import type { AppAbility, AppAuthFacts } from "./types.js";',
      "",
      'const memberTables = ["tasks", "notes"] as const;',
      'const memberActions = ["read", "create", "update", "delete", "export"] as const;',
      "",
      "export function buildAbility(ctx: AppAuthFacts): AppAbility {",
      "  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);",
      "",
      '  can("read", "public_api_sample");',
      "",
      '  if (ctx.principal.kind === "user") {',
      '    can("read", "hello");',
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
      '    can("manage", "all");',
      "  }",
      "",
      "  return build();",
      "}",
      "",
    ].join("\n"),
  );
}

describe("generated table authz and row security - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-table-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAuthMatrixSchema(project.projectDir);
    patchAuthMatrixAbility(project.projectDir);
    await runDrizzleMigrationCycle(project, "auth_matrix_tables");
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
      "category",
      "workspace_id",
      "scoped_to_user_id",
    ]);
    await assertSqliteTable(project, "countries", ["id", "code", "name"]);
    await buildGeneratedProject(project);
    server = await startBuiltServer(project, {
      SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
    });
  }, 420_000);

  afterAll(() => {
    stopServer(server);
    cleanupProject(project);
  });

  it("applies ability checks and row security to generated table actions", async () => {
    const baseUrl = server!.baseUrl;
    const owner = await createSignedUser("owner");

    const anonymousTasks = await requestJson<ErrorBody>(
      baseUrl,
      "/api/tables/tasks",
      { expectedStatus: 401, serverOutput: server!.output },
    );
    expect(anonymousTasks.body.code).toBe("unauthenticated");

    const ownerWorkspaceA = owner.context.workspace.id;
    const ownerTaskA = await createTask(owner.cookieFile, {
      title: "A owner alpha",
      status: "todo",
      priority: 2,
    });

    await requestJson<ErrorBody>(baseUrl, "/api/tables/tasks", {
      cookieFile: owner.cookieFile,
      method: "POST",
      body: {
        title: "Client scope",
        status: "todo",
        priority: 5,
        workspace_id: "workspace-b",
      },
      expectedStatus: 422,
      serverOutput: server!.output,
    }).then((response) => {
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    await requestJson<unknown>(baseUrl, "/api/auth/organization/create", {
      cookieFile: owner.cookieFile,
      method: "POST",
      body: { name: "Second Workspace", slug: `second-${Date.now()}` },
      expectedSuccess: true,
      serverOutput: server!.output,
    });
    const ownerContextB = await authContext(owner.cookieFile);
    const ownerWorkspaceB = ownerContextB.workspace.id;
    expect(ownerWorkspaceB).not.toBe(ownerWorkspaceA);

    const ownerTaskB = await createTask(owner.cookieFile, {
      title: "B owner gamma",
      status: "todo",
      priority: 3,
    });
    const ownerNoteB = await createNote(owner.cookieFile, {
      title: "B owner private",
      body: "hidden b note",
      category: "archive",
    });

    await switchWorkspace(owner.cookieFile, ownerWorkspaceA);
    const ownerNoteA = await createNote(owner.cookieFile, {
      title: "A owner private",
      body: "owner-only a note",
      category: "personal",
    });

    const member = await createSignedUser("member");
    await addWorkspaceMember(project!, {
      workspaceId: ownerWorkspaceA,
      userId: member.context.user.id,
      role: "member",
    });
    const memberContextA = await switchWorkspace(
      member.cookieFile,
      ownerWorkspaceA,
    );
    expect(memberContextA.workspace.id).toBe(ownerWorkspaceA);
    expect(
      memberContextA.isOwner ?? memberContextA.memberships[0]?.isOwner,
    ).toBe(false);

    const deniedCountries = await requestJson<ErrorBody>(
      baseUrl,
      "/api/tables/countries",
      {
        cookieFile: member.cookieFile,
        expectedStatus: 403,
        serverOutput: server!.output,
      },
    );
    expect(deniedCountries.body.code).toBe("forbidden");

    for (const deniedCountryAction of [
      await requestJson<ErrorBody>(baseUrl, "/api/tables/countries", {
        cookieFile: member.cookieFile,
        method: "POST",
        body: { code: "US", name: "United States" },
        expectedStatus: 403,
        serverOutput: server!.output,
      }),
      await requestJson<ErrorBody>(baseUrl, "/api/tables/countries/1", {
        cookieFile: member.cookieFile,
        method: "PUT",
        body: { name: "Updated country" },
        expectedStatus: 403,
        serverOutput: server!.output,
      }),
      await requestJson<ErrorBody>(baseUrl, "/api/tables/countries/1", {
        cookieFile: member.cookieFile,
        method: "DELETE",
        expectedStatus: 403,
        serverOutput: server!.output,
      }),
      await requestJson<ErrorBody>(
        baseUrl,
        "/api/tables/countries/export.csv",
        {
          cookieFile: member.cookieFile,
          expectedStatus: 403,
          serverOutput: server!.output,
        },
      ),
    ]) {
      expect(deniedCountryAction.body.code).toBe("forbidden");
    }

    const memberTaskA = await createTask(member.cookieFile, {
      title: "A member beta",
      status: "done",
      priority: 1,
    });
    const memberNoteA = await createNote(member.cookieFile, {
      title: "A member private",
      body: "member-only a note",
      category: "shared",
    });

    await expectVisibleTaskTitles(owner.cookieFile, [
      "A owner alpha",
      "A member beta",
    ]);
    await expectVisibleTaskTitles(member.cookieFile, [
      "A owner alpha",
      "A member beta",
    ]);
    await switchWorkspace(owner.cookieFile, ownerWorkspaceB);
    await expectVisibleTaskTitles(owner.cookieFile, ["B owner gamma"]);

    await switchWorkspace(owner.cookieFile, ownerWorkspaceA);
    await expectVisibleNoteTitles(owner.cookieFile, ["A owner private"]);
    await expectVisibleNoteTitles(member.cookieFile, ["A member private"]);
    await switchWorkspace(owner.cookieFile, ownerWorkspaceB);
    await expectVisibleNoteTitles(owner.cookieFile, ["B owner private"]);

    await switchWorkspace(owner.cookieFile, ownerWorkspaceA);
    await assertReadSupportOperations(owner.cookieFile, {
      visibleTaskIds: [ownerTaskA.id, memberTaskA.id],
      hiddenTaskId: ownerTaskB.id,
      visibleNoteId: ownerNoteA.id,
      hiddenNoteId: memberNoteA.id,
    });

    await assertMutationSafety(owner.cookieFile, {
      visibleTask: ownerTaskA,
      hiddenTask: ownerTaskB,
      visibleNote: ownerNoteA,
      otherUserNote: memberNoteA,
      inactiveWorkspaceNote: ownerNoteB,
    });
  });

  async function createSignedUser(label: string): Promise<SignedUser> {
    const email = `${label}-${Date.now()}@example.test`;
    const signedUp = await signUpEmailUser(project!, server!.baseUrl, {
      email,
      password: PASSWORD,
      name: label,
    });
    const signedIn = await signInEmailUser(project!, server!.baseUrl, signedUp);
    const context = await authContext(signedIn.cookieFile);
    expect(context.user.email).toBe(email);
    return { ...signedIn, context };
  }

  async function authContext(cookieFile: string): Promise<AuthContextBody> {
    return (
      await requestJson<AuthContextBody>(server!.baseUrl, "/api/auth-context", {
        cookieFile,
        expectedSuccess: true,
        serverOutput: server!.output,
      })
    ).body;
  }

  async function switchWorkspace(
    cookieFile: string,
    workspaceId: string,
  ): Promise<AuthContextBody> {
    return (
      await requestJson<AuthContextBody>(
        server!.baseUrl,
        "/api/auth-context/active-workspace",
        {
          cookieFile,
          method: "POST",
          body: { workspaceId },
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body;
  }

  async function createTask(
    cookieFile: string,
    body: Pick<TaskRow, "title" | "status" | "priority">,
  ): Promise<TaskRow> {
    return (
      await requestJson<RowBody<TaskRow>>(
        server!.baseUrl,
        "/api/tables/tasks",
        {
          cookieFile,
          method: "POST",
          body,
          expectedStatus: 201,
          serverOutput: server!.output,
        },
      )
    ).body.data;
  }

  async function createNote(
    cookieFile: string,
    body: Pick<NoteRow, "title" | "body" | "category">,
  ): Promise<NoteRow> {
    return (
      await requestJson<RowBody<NoteRow>>(
        server!.baseUrl,
        "/api/tables/notes",
        {
          cookieFile,
          method: "POST",
          body,
          expectedStatus: 201,
          serverOutput: server!.output,
        },
      )
    ).body.data;
  }

  async function expectVisibleTaskTitles(
    cookieFile: string,
    expectedTitles: string[],
  ): Promise<void> {
    const list = await listTasks(cookieFile);
    expect(list.data.map((row) => row.title).sort()).toEqual(
      [...expectedTitles].sort(),
    );
  }

  async function expectVisibleNoteTitles(
    cookieFile: string,
    expectedTitles: string[],
  ): Promise<void> {
    const list = await listNotes(cookieFile);
    expect(list.data.map((row) => row.title).sort()).toEqual(
      [...expectedTitles].sort(),
    );
  }

  async function listTasks(
    cookieFile: string,
    query = "",
  ): Promise<ListBody<TaskRow>> {
    return (
      await requestJson<ListBody<TaskRow>>(
        server!.baseUrl,
        `/api/tables/tasks${query}`,
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body;
  }

  async function listNotes(
    cookieFile: string,
    query = "",
  ): Promise<ListBody<NoteRow>> {
    return (
      await requestJson<ListBody<NoteRow>>(
        server!.baseUrl,
        `/api/tables/notes${query}`,
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body;
  }

  async function assertReadSupportOperations(
    cookieFile: string,
    input: {
      visibleTaskIds: number[];
      hiddenTaskId: number;
      visibleNoteId: number;
      hiddenNoteId: number;
    },
  ): Promise<void> {
    const hiddenFilter = await listTasks(
      cookieFile,
      "?filter[title][contains]=B%20owner",
    );
    expect(hiddenFilter.data).toEqual([]);
    expect(hiddenFilter.meta.total).toBe(0);

    const hiddenSearch = await listTasks(cookieFile, "?q=gamma");
    expect(hiddenSearch.data).toEqual([]);

    const pagedTasks = await listTasks(cookieFile, "?sort=priority&limit=1");
    expect(pagedTasks.data).toHaveLength(1);
    expect(pagedTasks.data[0]?.title).toBe("A member beta");
    expect(pagedTasks.meta.total).toBe(2);
    expect(pagedTasks.meta.pages).toBe(2);

    const taskLookup = (
      await requestJson<LookupBody>(
        server!.baseUrl,
        `/api/tables/tasks/_lookup?ids=${input.visibleTaskIds[0]},${input.hiddenTaskId}`,
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body.entries;
    expect(taskLookup).toEqual([
      { value: input.visibleTaskIds[0], label: "A owner alpha" },
    ]);

    const taskCount = (
      await requestJson<CountBody>(
        server!.baseUrl,
        "/api/tables/tasks/_count?group_by=status&ids=todo,done",
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body.data;
    expect(taskCount).toEqual({ done: 1, todo: 1 });

    const taskCsv = await curlText(
      `${server!.baseUrl}/api/tables/tasks/export.csv`,
      { cookieFile },
    );
    expect(taskCsv).toContain("A owner alpha");
    expect(taskCsv).toContain("A member beta");
    expect(taskCsv).not.toContain("B owner gamma");

    const hiddenNoteFilter = await listNotes(
      cookieFile,
      "?filter[title][contains]=member",
    );
    expect(hiddenNoteFilter.data).toEqual([]);

    const hiddenNoteSearch = await listNotes(cookieFile, "?q=member-only");
    expect(hiddenNoteSearch.data).toEqual([]);

    const noteLookup = (
      await requestJson<LookupBody>(
        server!.baseUrl,
        `/api/tables/notes/_lookup?ids=${input.visibleNoteId},${input.hiddenNoteId}`,
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body.entries;
    expect(noteLookup).toEqual([
      { value: input.visibleNoteId, label: "A owner private" },
    ]);

    const noteCount = (
      await requestJson<CountBody>(
        server!.baseUrl,
        "/api/tables/notes/_count?group_by=category&ids=personal,shared,archive",
        {
          cookieFile,
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body.data;
    expect(noteCount).toEqual({ personal: 1 });

    const noteCsv = await curlText(
      `${server!.baseUrl}/api/tables/notes/export.csv`,
      { cookieFile },
    );
    expect(noteCsv).toContain("A owner private");
    expect(noteCsv).not.toContain("A member private");
    expect(noteCsv).not.toContain("B owner private");
  }

  async function assertMutationSafety(
    cookieFile: string,
    input: {
      visibleTask: TaskRow;
      hiddenTask: TaskRow;
      visibleNote: NoteRow;
      otherUserNote: NoteRow;
      inactiveWorkspaceNote: NoteRow;
    },
  ): Promise<void> {
    await requestJson<ErrorBody>(
      server!.baseUrl,
      `/api/tables/tasks/${input.hiddenTask.id}`,
      { cookieFile, expectedStatus: 404, serverOutput: server!.output },
    );

    await requestJson<ErrorBody>(
      server!.baseUrl,
      `/api/tables/tasks/${input.hiddenTask.id}`,
      {
        cookieFile,
        method: "PUT",
        body: { title: "Bad update" },
        expectedStatus: 404,
        serverOutput: server!.output,
      },
    );
    await expectStoredTaskTitle(input.hiddenTask.id, input.hiddenTask.title);

    const updatedTask = (
      await requestJson<RowBody<TaskRow>>(
        server!.baseUrl,
        `/api/tables/tasks/${input.visibleTask.id}`,
        {
          cookieFile,
          method: "PUT",
          body: { title: "A owner alpha updated" },
          expectedSuccess: true,
          serverOutput: server!.output,
        },
      )
    ).body.data;
    expect(updatedTask.title).toBe("A owner alpha updated");

    await requestJson<ErrorBody>(
      server!.baseUrl,
      `/api/tables/tasks/${input.visibleTask.id}`,
      {
        cookieFile,
        method: "PUT",
        body: { workspace_id: "not-client-owned" },
        expectedStatus: 422,
        serverOutput: server!.output,
      },
    ).then((response) => {
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    await requestJson<ErrorBody>(
      server!.baseUrl,
      `/api/tables/tasks/${input.hiddenTask.id}`,
      {
        cookieFile,
        method: "DELETE",
        expectedStatus: 404,
        serverOutput: server!.output,
      },
    );
    await expectStoredTaskTitle(input.hiddenTask.id, input.hiddenTask.title);

    await requestJson<ErrorBody>(server!.baseUrl, "/api/tables/notes", {
      cookieFile,
      method: "POST",
      body: {
        title: "Client scoped note",
        body: "bad",
        category: "personal",
        workspace_id: "not-client-owned",
        scoped_to_user_id: "not-client-owned",
      },
      expectedStatus: 422,
      serverOutput: server!.output,
    }).then((response) => {
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });

    for (const note of [input.otherUserNote, input.inactiveWorkspaceNote]) {
      await requestJson<ErrorBody>(
        server!.baseUrl,
        `/api/tables/notes/${note.id}`,
        { cookieFile, expectedStatus: 404, serverOutput: server!.output },
      );
      await requestJson<ErrorBody>(
        server!.baseUrl,
        `/api/tables/notes/${note.id}`,
        {
          cookieFile,
          method: "PUT",
          body: { title: "Bad note update" },
          expectedStatus: 404,
          serverOutput: server!.output,
        },
      );
      await expectStoredNoteTitle(note.id, note.title);
      await requestJson<ErrorBody>(
        server!.baseUrl,
        `/api/tables/notes/${note.id}`,
        {
          cookieFile,
          method: "DELETE",
          expectedStatus: 404,
          serverOutput: server!.output,
        },
      );
      await expectStoredNoteTitle(note.id, note.title);
    }

    await requestJson<ErrorBody>(
      server!.baseUrl,
      `/api/tables/notes/${input.visibleNote.id}`,
      {
        cookieFile,
        method: "PUT",
        body: { scoped_to_user_id: "not-client-owned" },
        expectedStatus: 422,
        serverOutput: server!.output,
      },
    ).then((response) => {
      expect(response.body.code).toBe("VALIDATION_FAILED");
    });
  }

  async function expectStoredTaskTitle(
    id: number,
    expectedTitle: string,
  ): Promise<void> {
    const rows = await readSqliteRows<{ title: string }>(
      project!,
      "SELECT title FROM tasks WHERE id = ?",
      [id],
    );
    expect(rows).toEqual([{ title: expectedTitle }]);
  }

  async function expectStoredNoteTitle(
    id: number,
    expectedTitle: string,
  ): Promise<void> {
    const rows = await readSqliteRows<{ title: string }>(
      project!,
      "SELECT title FROM notes WHERE id = ?",
      [id],
    );
    expect(rows).toEqual([{ title: expectedTitle }]);
  }

  async function signUpEmailUser(
    testProject: E2eProject,
    baseUrl: string,
    credentials: {
      email: string;
      password: string;
      name?: string;
      cookieFile?: string;
    },
  ): Promise<SignedInEmailUser> {
    const cookieFile =
      credentials.cookieFile ?? cookieJar(testProject, credentials.email);
    await requestJson<unknown>(baseUrl, "/api/auth/sign-up/email", {
      cookieFile,
      method: "POST",
      body: {
        email: credentials.email,
        password: credentials.password,
        ...(credentials.name === undefined ? {} : { name: credentials.name }),
      },
      expectedSuccess: true,
      serverOutput: server!.output,
    });
    return {
      email: credentials.email,
      password: credentials.password,
      cookieFile,
    };
  }

  async function signInEmailUser(
    testProject: E2eProject,
    baseUrl: string,
    credentials: SignedInEmailUser,
  ): Promise<SignedInEmailUser> {
    const cookieFile =
      credentials.cookieFile ?? cookieJar(testProject, credentials.email);
    await requestJson<unknown>(baseUrl, "/api/auth/sign-in/email", {
      cookieFile,
      method: "POST",
      body: {
        email: credentials.email,
        password: credentials.password,
      },
      expectedSuccess: true,
      serverOutput: server!.output,
    });
    return {
      email: credentials.email,
      password: credentials.password,
      cookieFile,
    };
  }

  async function addWorkspaceMember(
    testProject: E2eProject,
    input: {
      workspaceId: string;
      userId: string;
      role: "owner" | "admin" | "member";
    },
  ): Promise<void> {
    await runSqliteStatement(
      testProject,
      "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), input.workspaceId, input.userId, input.role, Date.now()],
    );
  }

  async function readSqliteRows<T extends Record<string, unknown>>(
    testProject: E2eProject,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const databasePath = join(testProject.projectDir, "data", "sqlite.db");
    const queryScript = [
      'import Database from "better-sqlite3";',
      `const db = new Database(${JSON.stringify(databasePath)}, { readonly: true });`,
      `const rows = db.prepare(${JSON.stringify(sql)}).all(...${JSON.stringify(params)});`,
      "db.close();",
      "console.log(JSON.stringify(rows));",
    ].join("\n");
    const output = await runText("pnpm", sqliteNodeArgs(queryScript), {
      cwd: testProject.projectDir,
      env: testProject.env,
      timeoutMs: 30_000,
    });
    return parseJsonOutput<T[]>(output);
  }

  async function runSqliteStatement(
    testProject: E2eProject,
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<void> {
    const databasePath = join(testProject.projectDir, "data", "sqlite.db");
    const queryScript = [
      'import Database from "better-sqlite3";',
      `const db = new Database(${JSON.stringify(databasePath)});`,
      `db.prepare(${JSON.stringify(sql)}).run(...${JSON.stringify(params)});`,
      "db.close();",
    ].join("\n");
    await runText("pnpm", sqliteNodeArgs(queryScript), {
      cwd: testProject.projectDir,
      env: testProject.env,
      timeoutMs: 30_000,
    });
  }

  async function requestJson<T>(
    baseUrl: string,
    path: string,
    opts: JsonRequestOptions = {},
  ): Promise<JsonResponse<T>> {
    const raw = await requestRaw(`${baseUrl}${path}`, opts);
    const response: JsonResponse<T> = {
      status: raw.status,
      rawBody: raw.body,
      body:
        raw.body.length === 0 ? (undefined as T) : (JSON.parse(raw.body) as T),
    };
    assertExpectedStatus(response, opts);
    return response;
  }

  async function curlText(
    url: string,
    opts: { cookieFile?: string } = {},
  ): Promise<string> {
    const response = await requestRaw(url, {
      cookieFile: opts.cookieFile,
      expectedSuccess: true,
      serverOutput: server!.output,
    });
    return response.body;
  }

  async function requestRaw(
    url: string,
    opts: JsonRequestOptions,
  ): Promise<{ status: number; body: string }> {
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
    if (opts.body !== undefined) {
      args.push("-H", "Content-Type: application/json");
      args.push("-H", `Origin: ${new URL(url).origin}`);
      args.push("--data", JSON.stringify(opts.body));
    }
    args.push("-w", "\n%{http_code}", url);

    try {
      const output = await runText("curl", args, {
        cwd: project!.projectDir,
        env: project!.env,
        timeoutMs: 30_000,
      });
      const separator = output.lastIndexOf("\n");
      return {
        body: separator === -1 ? output : output.slice(0, separator),
        status: Number(separator === -1 ? "0" : output.slice(separator + 1)),
      };
    } finally {
      rmSync(headersFile, { force: true });
    }
  }

  function assertExpectedStatus<T>(
    response: JsonResponse<T>,
    opts: JsonRequestOptions,
  ): void {
    if (opts.expectedStatus !== undefined) {
      expect(
        response.status,
        httpExpectationMessage(response, opts.serverOutput),
      ).toBe(opts.expectedStatus);
    }
    if (opts.expectedSuccess === true) {
      expect(
        response.status,
        httpExpectationMessage(response, opts.serverOutput),
      ).toBeGreaterThanOrEqual(200);
      expect(
        response.status,
        httpExpectationMessage(response, opts.serverOutput),
      ).toBeLessThan(300);
    }
  }

  function httpExpectationMessage<T>(
    response: JsonResponse<T>,
    serverOutput: readonly string[] = [],
  ): string {
    return [
      `HTTP ${response.status}: ${response.rawBody}`,
      ...(serverOutput.length === 0 ? [] : ["Server output:", ...serverOutput]),
    ].join("\n");
  }

  function cookieJar(testProject: E2eProject, name: string): string {
    return join(
      testProject.parentDir,
      `${name.replace(/[^a-zA-Z0-9_-]+/g, "-")}.cookies.txt`,
    );
  }

  function sqliteNodeArgs(script: string): string[] {
    return [
      "--filter",
      "./packages/api",
      "exec",
      "node",
      "--input-type=module",
      "-e",
      script,
    ];
  }
});
