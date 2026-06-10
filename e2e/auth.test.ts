import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TASK_ONE,
  TASK_TWO,
  addWorkspaceMember,
  assertBetterSqliteLoads,
  assertSqliteTable,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  expectAuthContext,
  expectHttpError,
  expectNoScopeLeak,
  expectTableRowCount,
  expectVisibleTitles,
  makeCookieJar,
  readSqliteRows,
  requestJson,
  runDrizzleMigrationCycle,
  runSqliteStatement,
  scaffoldProject,
  signInEmailUser,
  signOutUser,
  signUpEmailUser,
  startBuiltServer,
  stopServer,
  writeAuthMatrixSchema,
  writeAuthzCustomRouteFixtures,
  type AuthContextBody,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

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

type AuthBootstrapBody = {
  userCount: number;
  workspaceCount: number;
  isEmpty: boolean;
};

type ProjectInfoBody = {
  name: string;
  slug: string;
};

type MessageBody = {
  message: string;
};

type AuthzPublicBody =
  | { kind: "anonymous"; email?: undefined }
  | { kind: "user"; email: string };

type AuthzWorkspaceBody = {
  workspaceId: string;
  role: "owner" | "member";
};

type StatusBody = {
  status: boolean;
};

type BetterAuthErrorBody = {
  code?: string;
  message?: string;
};

type UserRow = {
  id: string;
  email: string;
};

type MemberRow = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

type SessionRow = {
  id: string;
  userId: string;
  activeOrganizationId: string | null;
};

type ValidationErrorBody = {
  error: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
};

type CustomerRow = {
  id: number;
  name: string;
  tier: string;
  workspace_id: string;
};

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  workspace_id: string;
};

type InvoiceRow = {
  id: number;
  invoice_number: string;
  status: string;
  customer_id: number;
  workspace_id: string;
  scoped_to_user_id: string;
};

type InvoiceLineRow = {
  id: number;
  invoice_id: number;
  product_id: number;
  description: string;
  amount_cents: number;
  workspace_id: string;
  scoped_to_user_id: string;
};

type TableRowBody<T> = {
  data: T;
};

type TableRowsBody<T> = {
  data: T[];
};

type MasterDetailBody = {
  data: {
    master: InvoiceRow;
    details: InvoiceLineRow[];
  };
};

describe.sequential("sapporta init auth template - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-auth-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeAuthMatrixSchema(project.projectDir);
    writeAuthzCustomRouteFixtures(project.projectDir);
    await runDrizzleMigrationCycle(project, "auth_matrix");
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
    await assertSqliteTable(project, "customers", [
      "id",
      "name",
      "tier",
      "workspace_id",
    ]);
    await assertSqliteTable(project, "products", [
      "id",
      "sku",
      "name",
      "workspace_id",
    ]);
    await assertSqliteTable(project, "invoices", [
      "id",
      "invoice_number",
      "status",
      "customer_id",
      "workspace_id",
      "scoped_to_user_id",
    ]);
    await assertSqliteTable(project, "invoice_lines", [
      "id",
      "invoice_id",
      "product_id",
      "description",
      "amount_cents",
      "workspace_id",
      "scoped_to_user_id",
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

  it("keeps public API routes reachable and rejects anonymous protected routes", async () => {
    const baseUrl = server!.baseUrl;

    const bootstrap = await requestJson<AuthBootstrapBody>(
      `${baseUrl}/api/auth-bootstrap`,
      { expectedStatus: 200 },
    );
    expect(bootstrap.body).toEqual({
      userCount: 0,
      workspaceCount: 0,
      isEmpty: true,
    });

    const info = await requestJson<ProjectInfoBody>(
      `${baseUrl}/api/meta/info`,
      { expectedStatus: 200 },
    );
    expect(info.body).toEqual({
      name: "test-project",
      slug: "test-project",
    });

    const publicSample = await requestJson<MessageBody>(
      `${baseUrl}/api/public-api-sample`,
      { expectedStatus: 200 },
    );
    expect(publicSample.body).toEqual({
      message: "test-project public API sample",
    });

    for (const path of [
      "/api/auth-context",
      "/api/tables/tasks",
      "/api/reports",
      "/api/openapi.json",
      "/api/hello",
    ]) {
      const response = await requestJson<unknown>(`${baseUrl}${path}`, {
        expectedStatus: 401,
      });
      expectHttpError(response, 401, {
        error: "Authentication required",
        code: "unauthenticated",
      });
    }
  });

  it("creates and reuses an email/password session until signout", async () => {
    const baseUrl = server!.baseUrl;
    const credentials = {
      name: "Session Owner",
      email: "session-owner@example.test",
      password: "correct-horse-battery-staple",
    };

    await signUpEmailUser(project!, baseUrl, {
      ...credentials,
      cookieFile: makeCookieJar(project!, "session-signup"),
    });

    const bootstrap = await requestJson<AuthBootstrapBody>(
      `${baseUrl}/api/auth-bootstrap`,
      { expectedStatus: 200 },
    );
    expect(bootstrap.body).toEqual({
      userCount: 1,
      workspaceCount: 0,
      isEmpty: false,
    });

    const sessionJar = makeCookieJar(project!, "session-owner");
    await signInEmailUser(project!, baseUrl, {
      ...credentials,
      cookieFile: sessionJar,
    });

    const context = await requestJson<AuthContextBody>(
      `${baseUrl}/api/auth-context`,
      { cookieFile: sessionJar, expectedStatus: 200 },
    );
    expectAuthContext(context.body, {
      email: credentials.email,
      workspaceName: "Session Owner's Workspace",
      role: "owner",
      isOwner: true,
    });

    const hello = await requestJson<MessageBody>(`${baseUrl}/api/hello`, {
      cookieFile: sessionJar,
      expectedStatus: 200,
    });
    expect(hello.body).toEqual({ message: "Hello from test-project" });

    await signOutUser(baseUrl, sessionJar);

    for (const path of ["/api/auth-context", "/api/hello"]) {
      const response = await requestJson<unknown>(`${baseUrl}${path}`, {
        cookieFile: sessionJar,
        expectedStatus: 401,
      });
      expectHttpError(response, 401, { code: "unauthenticated" });
    }
  });

  it("signs up, provisions workspaces, and scopes table rows to the active workspace", async () => {
    const baseUrl = server!.baseUrl;
    const cookieFile = makeCookieJar(project!, "workspace-owner");
    const credentials = {
      email: "owner@example.test",
      password: "correct-horse-battery-staple",
      name: "Owner",
    };

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/auth-context", {
        cookieFile,
        expectedStatus: 401,
      }),
      401,
      { code: "unauthenticated" },
    );
    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/tables/tasks", {
        cookieFile,
        expectedStatus: 401,
      }),
      401,
      { code: "unauthenticated" },
    );

    await signUpEmailUser(project!, baseUrl, { ...credentials, cookieFile });
    await signInEmailUser(project!, baseUrl, {
      email: credentials.email,
      password: credentials.password,
      cookieFile,
    });

    const firstContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      {
        cookieFile,
        expectedStatus: 200,
      },
    );
    expectAuthContext(firstContext.body, {
      email: "owner@example.test",
      workspaceName: "Owner's Workspace",
      role: "owner",
      isOwner: true,
    });

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/tables/tasks", {
        cookieFile,
        method: "POST",
        body: { ...TASK_ONE, workspace_id: "workspace-2" },
        expectedStatus: 422,
      }),
      422,
      { code: "validation_failed" },
    );

    const firstTask = await requestJson<RowBody>(baseUrl, "/api/tables/tasks", {
      cookieFile,
      method: "POST",
      body: TASK_ONE,
      expectedStatus: 201,
    });
    expect(firstTask.body.data.title).toBe(TASK_ONE.title);
    expect(firstTask.body.data.workspace_id).toBe(
      firstContext.body.workspace.id,
    );

    await requestJson<unknown>(baseUrl, "/api/auth/organization/create", {
      cookieFile,
      method: "POST",
      body: {
        name: "Second Workspace",
        slug: "second-workspace",
      },
      expectedStatus: 200,
    });

    const secondContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      {
        cookieFile,
        expectedStatus: 200,
      },
    );
    expect(secondContext.body.workspace.id).not.toBe(
      firstContext.body.workspace.id,
    );
    expectAuthContext(secondContext.body, {
      workspaceSlug: "second-workspace",
      role: "owner",
      isOwner: true,
    });

    const secondTask = await requestJson<RowBody>(
      baseUrl,
      "/api/tables/tasks",
      {
        cookieFile,
        method: "POST",
        body: TASK_TWO,
        expectedStatus: 201,
      },
    );
    expect(secondTask.body.data.workspace_id).toBe(
      secondContext.body.workspace.id,
    );

    const secondList = await requestJson<RowsBody>(
      baseUrl,
      "/api/tables/tasks",
      {
        cookieFile,
        expectedStatus: 200,
      },
    );
    expectVisibleTitles(secondList.body, [TASK_TWO.title]);
    expectNoScopeLeak(secondList.body, {
      workspaceId: secondContext.body.workspace.id,
    });

    await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile,
        method: "POST",
        body: { workspaceId: firstContext.body.workspace.id },
        expectedStatus: 200,
      },
    );

    const firstList = await requestJson<RowsBody>(
      baseUrl,
      "/api/tables/tasks",
      {
        cookieFile,
        expectedStatus: 200,
      },
    );
    expectVisibleTitles(firstList.body, [TASK_ONE.title]);
    expectNoScopeLeak(firstList.body, {
      workspaceId: firstContext.body.workspace.id,
    });
    await expectTableRowCount(project!, "tasks", 2);
  });

  it("resolves the first signed-in workspace and stores it on the session", async () => {
    const baseUrl = server!.baseUrl;
    const user = await createSignedInUser("provisioned-owner", "Ada Lovelace");
    const userRow = await readUserByEmail(user.email);
    const membershipsBeforeContext = await readMembersForUser(userRow.id);
    expect(membershipsBeforeContext.length).toBeLessThanOrEqual(1);
    if (membershipsBeforeContext.length === 1) {
      expect(membershipsBeforeContext[0]?.role).toBe("owner");
    }

    const context = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      {
        cookieFile: user.cookieFile,
        expectedStatus: 200,
      },
    );
    expectAuthContext(context.body, {
      email: user.email,
      workspaceName: "Ada Lovelace's Workspace",
      workspaceSlug: "ada-lovelace-s-workspace",
      role: "owner",
      isOwner: true,
    });

    const membershipsAfterContext = await readMembersForUser(userRow.id);
    expect(membershipsAfterContext).toHaveLength(1);
    expect(membershipsAfterContext[0]?.role).toBe("owner");

    const activeSessions = await readSessionsForUser(userRow.id);
    expect(
      activeSessions.some(
        (row) => row.activeOrganizationId === context.body.workspace.id,
      ),
    ).toBe(true);
  });

  it("maps roles from the active workspace membership", async () => {
    const baseUrl = server!.baseUrl;
    const owner = await createSignedInUser("role-owner", "Role Owner");
    const ownerContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );

    const member = await createSignedInUser("role-member", "Role Member");
    const memberOwnContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: member.cookieFile, expectedStatus: 200 },
    );
    const memberRow = await readUserByEmail(member.email);
    await addWorkspaceMember(project!, {
      workspaceId: ownerContext.body.workspace.id,
      userId: memberRow.id,
      role: "member",
    });

    const memberSwitched = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: member.cookieFile,
        method: "POST",
        body: { workspaceId: ownerContext.body.workspace.id },
        expectedStatus: 200,
      },
    );
    expectAuthContext(memberSwitched.body, {
      email: member.email,
      workspaceId: ownerContext.body.workspace.id,
      role: "member",
      isOwner: false,
    });

    const memberHello = await requestJson<MessageBody>(baseUrl, "/api/hello", {
      cookieFile: member.cookieFile,
      expectedStatus: 200,
    });
    expect(memberHello.body).toEqual({ message: "Hello from test-project" });

    const memberTables = await requestJson<unknown>(
      baseUrl,
      "/api/tables/tasks",
      {
        cookieFile: member.cookieFile,
        expectedStatus: 403,
      },
    );
    expectHttpError(memberTables, 403, { code: "forbidden" });

    await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: member.cookieFile,
        method: "POST",
        body: { workspaceId: memberOwnContext.body.workspace.id },
        expectedStatus: 200,
      },
    );

    const admin = await createSignedInUser("role-admin", "Role Admin");
    await requestJson<AuthContextBody>(baseUrl, "/api/auth-context", {
      cookieFile: admin.cookieFile,
      expectedStatus: 200,
    });
    const adminRow = await readUserByEmail(admin.email);
    await addWorkspaceMember(project!, {
      workspaceId: ownerContext.body.workspace.id,
      userId: adminRow.id,
      role: "admin",
    });

    const adminSwitched = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: admin.cookieFile,
        method: "POST",
        body: { workspaceId: ownerContext.body.workspace.id },
        expectedStatus: 200,
      },
    );
    expectAuthContext(adminSwitched.body, {
      email: admin.email,
      workspaceId: ownerContext.body.workspace.id,
      role: "owner",
      isOwner: true,
    });

    await requestJson<RowsBody>(baseUrl, "/api/tables/tasks", {
      cookieFile: admin.cookieFile,
      expectedStatus: 200,
    });
  });

  it("rejects forbidden switches and recovers stale active workspaces", async () => {
    const baseUrl = server!.baseUrl;
    const owner = await createSignedInUser("switch-owner", "Switch Owner");
    const ownerContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    const outsider = await createSignedInUser(
      "switch-outsider",
      "Switch Outsider",
    );
    const outsiderContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: outsider.cookieFile, expectedStatus: 200 },
    );

    const forbidden = await requestJson<unknown>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: { workspaceId: outsiderContext.body.workspace.id },
        expectedStatus: 403,
      },
    );
    expectHttpError(forbidden, 403, { code: "forbidden" });

    for (const body of [{}, { workspaceId: 42 }]) {
      const invalid = await requestJson<unknown>(
        baseUrl,
        "/api/auth-context/active-workspace",
        {
          cookieFile: owner.cookieFile,
          method: "POST",
          body,
          expectedStatus: 400,
        },
      );
      expect(invalid.status).toBe(400);
    }

    const staleUser = await createSignedInUser("stale-member", "Stale Member");
    const staleOwnContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: staleUser.cookieFile, expectedStatus: 200 },
    );
    const staleUserRow = await readUserByEmail(staleUser.email);
    await addWorkspaceMember(project!, {
      workspaceId: ownerContext.body.workspace.id,
      userId: staleUserRow.id,
      role: "member",
    });
    await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: staleUser.cookieFile,
        method: "POST",
        body: { workspaceId: ownerContext.body.workspace.id },
        expectedStatus: 200,
      },
    );
    await runSqliteStatement(
      project!,
      "DELETE FROM member WHERE organizationId = ? AND userId = ?",
      [ownerContext.body.workspace.id, staleUserRow.id],
    );

    const recovered = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: staleUser.cookieFile, expectedStatus: 200 },
    );
    expectAuthContext(recovered.body, {
      email: staleUser.email,
      workspaceId: staleOwnContext.body.workspace.id,
      role: "owner",
      isOwner: true,
    });
  });

  it("enforces custom route authorization patterns", async () => {
    const baseUrl = server!.baseUrl;

    const anonymousPublic = await requestJson<AuthzPublicBody>(
      baseUrl,
      "/api/authz/public",
      { expectedStatus: 200 },
    );
    expect(anonymousPublic.body).toEqual({ kind: "anonymous" });

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/authz/private", {
        expectedStatus: 401,
      }),
      401,
      { code: "unauthenticated" },
    );

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/authz/public-denied", {
        expectedStatus: 403,
      }),
      403,
      { code: "forbidden" },
    );

    const owner = await createSignedInUser("authz-route-owner", "Route Owner");
    const ownerContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );

    const signedInPublic = await requestJson<AuthzPublicBody>(
      baseUrl,
      "/api/authz/public",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(signedInPublic.body).toEqual({
      kind: "user",
      email: owner.email,
    });

    const privateRoute = await requestJson<{ email: string }>(
      baseUrl,
      "/api/authz/private",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(privateRoute.body).toEqual({ email: owner.email });

    const ownerWorkspace = await requestJson<AuthzWorkspaceBody>(
      baseUrl,
      "/api/authz/workspace",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(ownerWorkspace.body).toEqual({
      workspaceId: ownerContext.body.workspace.id,
      role: "owner",
    });

    const ownerOnly = await requestJson<{ workspaceId: string }>(
      baseUrl,
      "/api/authz/owner",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(ownerOnly.body).toEqual({
      workspaceId: ownerContext.body.workspace.id,
    });

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/authz/custom-tasks", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          title: "Client scoped task",
          status: "todo",
          priority: 1,
          workspace_id: "client-workspace",
        },
        expectedStatus: 422,
      }),
      422,
      { code: "validation_failed" },
    );

    const firstCustomTask = await requestJson<RowBody>(
      baseUrl,
      "/api/authz/custom-tasks",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          title: "Owner first custom task",
          status: "todo",
          priority: 1,
        },
        expectedStatus: 200,
      },
    );
    expect(firstCustomTask.body.data.workspace_id).toBe(
      ownerContext.body.workspace.id,
    );

    await requestJson<unknown>(baseUrl, "/api/auth/organization/create", {
      cookieFile: owner.cookieFile,
      method: "POST",
      body: {
        name: "Custom Route Second Workspace",
        slug: "custom-route-second-workspace",
      },
      expectedStatus: 200,
    });
    const secondContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(secondContext.body.workspace.id).not.toBe(
      ownerContext.body.workspace.id,
    );

    const secondCustomTask = await requestJson<RowBody>(
      baseUrl,
      "/api/authz/custom-tasks",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          title: "Owner second custom task",
          status: "in_progress",
          priority: 2,
        },
        expectedStatus: 200,
      },
    );
    expect(secondCustomTask.body.data.workspace_id).toBe(
      secondContext.body.workspace.id,
    );

    const secondVisible = await requestJson<RowsBody>(
      baseUrl,
      "/api/authz/custom-tasks",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expectVisibleTitles(secondVisible.body, ["Owner second custom task"]);
    expectNoScopeLeak(secondVisible.body, {
      workspaceId: secondContext.body.workspace.id,
    });

    expectHttpError(
      await requestJson<unknown>(
        baseUrl,
        `/api/authz/custom-tasks/${firstCustomTask.body.data.id}`,
        {
          cookieFile: owner.cookieFile,
          method: "PATCH",
          body: { status: "done" },
          expectedStatus: 404,
        },
      ),
      404,
      { code: "not_found" },
    );

    await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: { workspaceId: ownerContext.body.workspace.id },
        expectedStatus: 200,
      },
    );
    const updatedFirstTask = await requestJson<RowBody>(
      baseUrl,
      `/api/authz/custom-tasks/${firstCustomTask.body.data.id}`,
      {
        cookieFile: owner.cookieFile,
        method: "PATCH",
        body: { status: "done" },
        expectedStatus: 200,
      },
    );
    expect(updatedFirstTask.body.data.status).toBe("done");
    expect(updatedFirstTask.body.data.workspace_id).toBe(
      ownerContext.body.workspace.id,
    );

    const member = await createSignedInUser(
      "authz-route-member",
      "Route Member",
    );
    const memberContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: member.cookieFile, expectedStatus: 200 },
    );
    await addWorkspaceMember(project!, {
      workspaceId: ownerContext.body.workspace.id,
      userId: memberContext.body.user.id,
      role: "member",
    });
    await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context/active-workspace",
      {
        cookieFile: member.cookieFile,
        method: "POST",
        body: { workspaceId: ownerContext.body.workspace.id },
        expectedStatus: 200,
      },
    );

    const memberWorkspace = await requestJson<AuthzWorkspaceBody>(
      baseUrl,
      "/api/authz/workspace",
      { cookieFile: member.cookieFile, expectedStatus: 200 },
    );
    expect(memberWorkspace.body).toEqual({
      workspaceId: ownerContext.body.workspace.id,
      role: "member",
    });

    expectHttpError(
      await requestJson<unknown>(baseUrl, "/api/authz/owner", {
        cookieFile: member.cookieFile,
        expectedStatus: 403,
      }),
      403,
      { code: "forbidden" },
    );

    const unrelated = await createSignedInUser(
      "authz-route-unrelated",
      "Route Unrelated",
    );
    expectHttpError(
      await requestJson<unknown>(
        baseUrl,
        "/api/auth-context/active-workspace",
        {
          cookieFile: unrelated.cookieFile,
          method: "POST",
          body: { workspaceId: ownerContext.body.workspace.id },
          expectedStatus: 403,
        },
      ),
      403,
      { code: "forbidden" },
    );
  });

  it("enforces reference visibility and master-detail rollback", async () => {
    const baseUrl = server!.baseUrl;
    const owner = await createSignedInUser(
      "reference-owner",
      "Reference Owner",
    );
    const ownerContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    const workspaceAId = ownerContext.body.workspace.id;
    const ownerUserId = ownerContext.body.user.id;

    const customerA = await createCustomer(owner.cookieFile, {
      name: "Visible Customer",
      tier: "standard",
    });
    const customerA2 = await createCustomer(owner.cookieFile, {
      name: "Second Visible Customer",
      tier: "priority",
    });
    const productA = await createProduct(owner.cookieFile, {
      sku: "VISIBLE-001",
      name: "Visible Product",
    });

    await requestJson<unknown>(baseUrl, "/api/auth/organization/create", {
      cookieFile: owner.cookieFile,
      method: "POST",
      body: {
        name: "Reference Second Workspace",
        slug: "reference-second-workspace",
      },
      expectedStatus: 200,
    });
    const workspaceB = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    const workspaceBId = workspaceB.body.workspace.id;
    const customerB = await createCustomer(owner.cookieFile, {
      name: "Invisible Customer",
      tier: "standard",
    });
    const productB = await createProduct(owner.cookieFile, {
      sku: "HIDDEN-001",
      name: "Hidden Product",
    });

    await switchWorkspace(owner.cookieFile, workspaceAId);

    const invoice = await createInvoice(owner.cookieFile, {
      invoice_number: "INV-FK-001",
      status: "draft",
      customer_id: customerA.id,
    });
    expect(invoice.customer_id).toBe(customerA.id);
    expect(invoice.workspace_id).toBe(workspaceAId);
    expect(invoice.scoped_to_user_id).toBe(ownerUserId);

    const visibleUpdate = await requestJson<TableRowBody<InvoiceRow>>(
      baseUrl,
      `/api/tables/invoices/${invoice.id}`,
      {
        cookieFile: owner.cookieFile,
        method: "PUT",
        body: { customer_id: customerA2.id },
        expectedStatus: 200,
      },
    );
    expect(visibleUpdate.body.data.customer_id).toBe(customerA2.id);

    const unrelatedUpdate = await requestJson<TableRowBody<InvoiceRow>>(
      baseUrl,
      `/api/tables/invoices/${invoice.id}`,
      {
        cookieFile: owner.cookieFile,
        method: "PUT",
        body: { status: "sent" },
        expectedStatus: 200,
      },
    );
    expect(unrelatedUpdate.body.data.status).toBe("sent");

    expectValidationFields(
      await requestJson<ValidationErrorBody>(baseUrl, "/api/tables/invoices", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-HIDDEN-CUSTOMER",
          status: "draft",
          customer_id: customerB.id,
        },
        expectedStatus: 422,
      }),
      ["customer_id"],
    );
    expectValidationFields(
      await requestJson<ValidationErrorBody>(baseUrl, "/api/tables/invoices", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-MISSING-CUSTOMER",
          status: "draft",
          customer_id: 999_999,
        },
        expectedStatus: 422,
      }),
      ["customer_id"],
    );
    expectValidationFields(
      await requestJson<ValidationErrorBody>(
        baseUrl,
        `/api/tables/invoices/${invoice.id}`,
        {
          cookieFile: owner.cookieFile,
          method: "PUT",
          body: { customer_id: customerB.id },
          expectedStatus: 422,
        },
      ),
      ["customer_id"],
    );

    expectValidationFields(
      await requestJson<ValidationErrorBody>(
        baseUrl,
        "/api/tables/invoice_lines",
        {
          cookieFile: owner.cookieFile,
          method: "POST",
          body: {
            invoice_id: invoice.id,
            product_id: productA.id,
            description: "Direct line attempt",
            amount_cents: 500,
          },
          expectedStatus: 422,
        },
      ),
      ["invoice_id"],
    );

    const other = await createSignedInUser(
      "reference-other",
      "Reference Other",
    );
    const otherInitialContext = await requestJson<AuthContextBody>(
      baseUrl,
      "/api/auth-context",
      { cookieFile: other.cookieFile, expectedStatus: 200 },
    );
    await addWorkspaceMember(project!, {
      workspaceId: workspaceAId,
      userId: otherInitialContext.body.user.id,
      role: "owner",
    });
    await switchWorkspace(other.cookieFile, workspaceAId);
    const otherInvoice = await createInvoice(other.cookieFile, {
      invoice_number: "INV-OTHER-USER",
      status: "draft",
      customer_id: customerA.id,
    });

    const beforeMalformed = await countTableRows("invoices");
    const malformedDetails = await requestJson<ValidationErrorBody>(
      baseUrl,
      "/api/tables/invoices",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-MALFORMED-DETAILS",
          status: "draft",
          customer_id: customerA.id,
          $details: { table: "invoice_lines" },
        },
        expectedStatus: 400,
      },
    );
    expect(malformedDetails.body.error).toMatch(/\$details/);
    expect(await countTableRows("invoices")).toBe(beforeMalformed);

    const beforeMissingDetail = await countTableRows("invoices");
    const missingDetailTable = await requestJson<ValidationErrorBody>(
      baseUrl,
      "/api/tables/invoices",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-MISSING-DETAIL-TABLE",
          status: "draft",
          customer_id: customerA.id,
          $details: {
            table: "missing_lines",
            fk: "invoice_id",
            rows: [],
          },
        },
        expectedStatus: 404,
      },
    );
    expect(missingDetailTable.body.error).toMatch(/Detail table/);
    expect(await countTableRows("invoices")).toBe(beforeMissingDetail);

    const beforeClientInvoiceId = await countTableRows("invoices");
    expectValidationFields(
      await requestJson<ValidationErrorBody>(baseUrl, "/api/tables/invoices", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-CLIENT-INVOICE-ID",
          status: "draft",
          customer_id: customerA.id,
          $details: {
            table: "invoice_lines",
            fk: "invoice_id",
            rows: [
              {
                invoice_id: otherInvoice.id,
                product_id: productA.id,
                description: "Client supplied invoice",
                amount_cents: 1000,
              },
            ],
          },
        },
        expectedStatus: 422,
        serverOutput: server?.output,
      }),
      ["invoice_id"],
    );
    expect(await countTableRows("invoices")).toBe(beforeClientInvoiceId);

    const beforeClientScope = await countTableRows("invoices");
    expectValidationFields(
      await requestJson<ValidationErrorBody>(baseUrl, "/api/tables/invoices", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-CLIENT-SCOPE",
          status: "draft",
          customer_id: customerA.id,
          $details: {
            table: "invoice_lines",
            fk: "invoice_id",
            rows: [
              {
                product_id: productA.id,
                description: "Client supplied scope",
                amount_cents: 1000,
                workspace_id: workspaceBId,
                scoped_to_user_id: otherInitialContext.body.user.id,
              },
            ],
          },
        },
        expectedStatus: 422,
      }),
      ["workspace_id", "scoped_to_user_id"],
    );
    expect(await countTableRows("invoices")).toBe(beforeClientScope);

    const beforeInvisibleProduct = await countTableRows("invoices");
    expectValidationFields(
      await requestJson<ValidationErrorBody>(baseUrl, "/api/tables/invoices", {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-HIDDEN-PRODUCT",
          status: "draft",
          customer_id: customerA.id,
          $details: {
            table: "invoice_lines",
            fk: "invoice_id",
            rows: [
              {
                product_id: productB.id,
                description: "Hidden product",
                amount_cents: 1000,
              },
            ],
          },
        },
        expectedStatus: 422,
      }),
      ["product_id"],
    );
    expect(await countTableRows("invoices")).toBe(beforeInvisibleProduct);

    const masterDetail = await requestJson<MasterDetailBody>(
      baseUrl,
      "/api/tables/invoices",
      {
        cookieFile: owner.cookieFile,
        method: "POST",
        body: {
          invoice_number: "INV-MASTER-DETAIL",
          status: "draft",
          customer_id: customerA2.id,
          $details: {
            table: "invoice_lines",
            fk: "invoice_id",
            rows: [
              {
                product_id: productA.id,
                description: "Implementation work",
                amount_cents: 12500,
              },
              {
                product_id: productA.id,
                description: "Review work",
                amount_cents: 7500,
              },
            ],
          },
        },
        expectedStatus: [200, 201],
      },
    );
    expect(masterDetail.body.data.master.workspace_id).toBe(workspaceAId);
    expect(masterDetail.body.data.master.scoped_to_user_id).toBe(ownerUserId);
    expect(masterDetail.body.data.details).toHaveLength(2);
    for (const line of masterDetail.body.data.details) {
      expect(line.invoice_id).toBe(masterDetail.body.data.master.id);
      expect(line.workspace_id).toBe(workspaceAId);
      expect(line.scoped_to_user_id).toBe(ownerUserId);
    }

    const ownerInvoices = await requestJson<TableRowsBody<InvoiceRow>>(
      baseUrl,
      "/api/tables/invoices",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    const ownerInvoiceNumbers = ownerInvoices.body.data.map(
      (row) => row.invoice_number,
    );
    expect(ownerInvoiceNumbers).toEqual(
      expect.arrayContaining(["INV-FK-001", "INV-MASTER-DETAIL"]),
    );
    expect(ownerInvoiceNumbers).not.toContain(otherInvoice.invoice_number);
    expectNoScopeLeak(ownerInvoices.body, {
      workspaceId: workspaceAId,
      scopedToUserId: ownerUserId,
    });

    const ownerLines = await requestJson<TableRowsBody<InvoiceLineRow>>(
      baseUrl,
      "/api/tables/invoice_lines",
      { cookieFile: owner.cookieFile, expectedStatus: 200 },
    );
    expect(ownerLines.body.data.map((line) => line.description)).toEqual([
      "Implementation work",
      "Review work",
    ]);
    expectNoScopeLeak(ownerLines.body, {
      workspaceId: workspaceAId,
      scopedToUserId: ownerUserId,
    });

    const otherInvoices = await requestJson<TableRowsBody<InvoiceRow>>(
      baseUrl,
      "/api/tables/invoices",
      { cookieFile: other.cookieFile, expectedStatus: 200 },
    );
    expect(otherInvoices.body.data.map((row) => row.invoice_number)).toEqual([
      otherInvoice.invoice_number,
    ]);
    const otherLines = await requestJson<TableRowsBody<InvoiceLineRow>>(
      baseUrl,
      "/api/tables/invoice_lines",
      { cookieFile: other.cookieFile, expectedStatus: 200 },
    );
    expect(otherLines.body.data).toEqual([]);

    await switchWorkspace(owner.cookieFile, workspaceBId);
    const hiddenByWorkspaceInvoices = await requestJson<
      TableRowsBody<InvoiceRow>
    >(baseUrl, "/api/tables/invoices", {
      cookieFile: owner.cookieFile,
      expectedStatus: 200,
    });
    expect(hiddenByWorkspaceInvoices.body.data).toEqual([]);
    const hiddenByWorkspaceLines = await requestJson<
      TableRowsBody<InvoiceLineRow>
    >(baseUrl, "/api/tables/invoice_lines", {
      cookieFile: owner.cookieFile,
      expectedStatus: 200,
    });
    expect(hiddenByWorkspaceLines.body.data).toEqual([]);
  });

  it("rejects invalid email/password auth requests", async () => {
    const baseUrl = server!.baseUrl;
    const cookieJar = makeCookieJar(project!, "failure-owner");
    const credentials = {
      name: "Failure Owner",
      email: "failure-owner@example.test",
      password: "correct-horse-battery-staple",
    };

    await signUpEmailUser(project!, baseUrl, {
      ...credentials,
      cookieFile: cookieJar,
    });

    const wrongPassword = await requestJson<unknown>(
      `${baseUrl}/api/auth/sign-in/email`,
      {
        method: "POST",
        body: {
          email: credentials.email,
          password: "wrong-horse-battery-staple",
        },
      },
    );
    expectClientAuthFailure(wrongPassword.status);

    const unknownUser = await requestJson<unknown>(
      `${baseUrl}/api/auth/sign-in/email`,
      {
        method: "POST",
        body: {
          email: "unknown-user@example.test",
          password: credentials.password,
        },
      },
    );
    expectClientAuthFailure(unknownUser.status);

    const duplicateSignup = await requestJson<unknown>(
      `${baseUrl}/api/auth/sign-up/email`,
      {
        method: "POST",
        body: credentials,
      },
    );
    expectClientAuthFailure(duplicateSignup.status);

    const malformedEmail = await requestJson<unknown>(
      `${baseUrl}/api/auth/sign-up/email`,
      {
        method: "POST",
        body: {
          name: "Malformed",
          email: "not-an-email",
          password: credentials.password,
        },
      },
    );
    expectClientAuthFailure(malformedEmail.status);

    const missingPassword = await requestJson<unknown>(
      `${baseUrl}/api/auth/sign-up/email`,
      {
        method: "POST",
        body: {
          name: "Missing Password",
          email: "missing-password@example.test",
        },
      },
    );
    expectClientAuthFailure(missingPassword.status);
  });

  it("enforces verified-email policy and keeps auth email endpoints wired", async () => {
    const localBaseUrl = server!.baseUrl;
    const policyJar = makeCookieJar(project!, "verification-policy-user");
    const credentials = {
      name: "Verification Policy User",
      email: "verification-policy@example.test",
      password: "correct-horse-battery-staple",
    };

    await signUpEmailUser(project!, localBaseUrl, {
      ...credentials,
      cookieFile: policyJar,
    });

    const localContext = await requestJson<AuthContextBody>(
      localBaseUrl,
      "/api/auth-context",
      { cookieFile: policyJar, expectedStatus: 200 },
    );
    expect(localContext.body.user.email).toBe(credentials.email);
    expect(localContext.body.user.emailVerified).toBe(false);

    await requestJson<RowsBody>(localBaseUrl, "/api/tables/tasks", {
      cookieFile: policyJar,
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
      { cookieFile: policyJar, expectedStatus: 403 },
    );
    expectHttpError(contextWhileUnverified, 403, {
      code: "email_not_verified",
      error: "Email verification required",
    });

    for (const path of ["/api/hello", "/api/tables/tasks"]) {
      const response = await requestJson<unknown>(requiredBaseUrl, path, {
        cookieFile: policyJar,
        expectedStatus: 403,
      });
      expectHttpError(response, 403, {
        code: "email_not_verified",
        error: "Email verification required",
      });
    }

    const blockedSigninJar = makeCookieJar(
      project!,
      "verification-policy-signin",
    );
    const blockedSignin = await requestJson<BetterAuthErrorBody>(
      requiredBaseUrl,
      "/api/auth/sign-in/email",
      {
        cookieFile: blockedSigninJar,
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
      `${requiredBaseUrl}/api/auth/verify-email?token=invalid-token`,
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

    const resetWithoutToken = await requestJson<BetterAuthErrorBody>(
      requiredBaseUrl,
      "/api/auth/reset-password",
      {
        method: "POST",
        body: { newPassword: "new-correct-horse-battery-staple" },
        expectedStatus: 400,
      },
    );
    expect(resetWithoutToken.body.code).toBe("INVALID_TOKEN");

    const resetInvalidToken = await requestJson<BetterAuthErrorBody>(
      requiredBaseUrl,
      "/api/auth/reset-password",
      {
        method: "POST",
        body: {
          newPassword: "new-correct-horse-battery-staple",
          token: "invalid-token",
        },
        expectedStatus: 400,
      },
    );
    expect(resetInvalidToken.body.code).toBe("INVALID_TOKEN");

    await runSqliteStatement(
      project!,
      'UPDATE "user" SET "emailVerified" = 1 WHERE "email" = ?',
      [credentials.email],
    );

    const verifiedContext = await requestJson<AuthContextBody>(
      requiredBaseUrl,
      "/api/auth-context",
      { cookieFile: policyJar, expectedStatus: 200 },
    );
    expect(verifiedContext.body.user.emailVerified).toBe(true);

    const verifiedRows = await requestJson<RowsBody>(
      requiredBaseUrl,
      "/api/tables/tasks",
      { cookieFile: policyJar, expectedStatus: 200 },
    );
    expect(Array.isArray(verifiedRows.body.data)).toBe(true);
  });

  async function createSignedInUser(
    label: string,
    name: string,
  ): Promise<{ email: string; password: string; cookieFile: string }> {
    const baseUrl = server!.baseUrl;
    const email = `${label}@example.test`;
    const password = "correct-horse-battery-staple";
    const cookieFile = makeCookieJar(project!, label);
    await signUpEmailUser(project!, baseUrl, {
      name,
      email,
      password,
      cookieFile,
    });
    await signInEmailUser(project!, baseUrl, { email, password, cookieFile });
    return { email, password, cookieFile };
  }

  async function readUserByEmail(email: string): Promise<UserRow> {
    const rows = await readSqliteRows<UserRow>(
      project!,
      'SELECT "id", "email" FROM "user" WHERE "email" = ?',
      [email],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function readMembersForUser(userId: string): Promise<MemberRow[]> {
    return readSqliteRows<MemberRow>(
      project!,
      'SELECT "id", "organizationId", "userId", "role" FROM "member" WHERE "userId" = ? ORDER BY "createdAt" ASC, "id" ASC',
      [userId],
    );
  }

  async function readSessionsForUser(userId: string): Promise<SessionRow[]> {
    return readSqliteRows<SessionRow>(
      project!,
      'SELECT "id", "userId", "activeOrganizationId" FROM "session" WHERE "userId" = ?',
      [userId],
    );
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
      },
    );
    return response.body;
  }

  async function createCustomer(
    cookieFile: string,
    body: Pick<CustomerRow, "name" | "tier">,
  ): Promise<CustomerRow> {
    const response = await requestJson<TableRowBody<CustomerRow>>(
      server!.baseUrl,
      "/api/tables/customers",
      {
        cookieFile,
        method: "POST",
        body,
        expectedStatus: [200, 201],
      },
    );
    return response.body.data;
  }

  async function createProduct(
    cookieFile: string,
    body: Pick<ProductRow, "sku" | "name">,
  ): Promise<ProductRow> {
    const response = await requestJson<TableRowBody<ProductRow>>(
      server!.baseUrl,
      "/api/tables/products",
      {
        cookieFile,
        method: "POST",
        body,
        expectedStatus: [200, 201],
      },
    );
    return response.body.data;
  }

  async function createInvoice(
    cookieFile: string,
    body: Pick<InvoiceRow, "invoice_number" | "status" | "customer_id">,
  ): Promise<InvoiceRow> {
    const response = await requestJson<TableRowBody<InvoiceRow>>(
      server!.baseUrl,
      "/api/tables/invoices",
      {
        cookieFile,
        method: "POST",
        body,
        expectedStatus: [200, 201],
      },
    );
    return response.body.data;
  }

  async function countTableRows(tableName: "invoices"): Promise<number> {
    const rows = await readSqliteRows<{ count: number }>(
      project!,
      `SELECT COUNT(*) AS count FROM "${tableName}"`,
    );
    return rows[0]?.count ?? 0;
  }

  function expectValidationFields(
    response: { status: number; body: ValidationErrorBody; rawBody: string },
    fields: readonly string[],
  ): void {
    expect(response.status, response.rawBody).toBe(422);
    expect(response.body.code, response.rawBody).toBe("validation_failed");
    const actualFields = response.body.details?.map((detail) => detail.field);
    expect(actualFields, response.rawBody).toEqual(
      expect.arrayContaining([...fields]),
    );
  }

  function expectClientAuthFailure(status: number): void {
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  }
});
