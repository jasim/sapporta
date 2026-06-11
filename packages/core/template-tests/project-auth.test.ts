import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  connectProject,
  createAuthContext,
  createTableCatalog,
  allowOnlySystemWideRows,
  allowWorkspaceWideRows,
  type BuildAbility,
  type ProjectDbConnection,
  type RowsAllowedForRequest,
  type SapportaAbility,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import type { BetterAuthSessionApi } from "../src/templates/project-auth/better-auth.js";
import {
  resolveSapportaAuthContext,
  switchActiveWorkspace,
  type BetterAuthSessionPayload,
  type ResolveRowsAllowedForRequest,
} from "../src/templates/project-auth/context.js";
import {
  rejectAnonymousByDefault,
  requireAuthContext,
  requirePrincipalUser,
  requireVerifiedUser,
  requireWorkspaceOwner,
  requireWorkspaceRowsAllowed,
  resolveProjectAuthMiddleware,
} from "../src/templates/project-auth/middleware.js";
import type {
  AppAbility,
  AppWorkspaceMembership,
} from "../src/templates/packages/api/authz/types.js";
import { buildAbility as buildTemplateAbility } from "../src/templates/packages/api/authz/ability.js";
import { readProjectAuthEnv } from "../src/templates/project-auth/env.js";
import {
  WorkspaceSwitchError,
  ensureActiveWorkspace,
  switchWorkspaceMembership,
} from "../src/templates/project-auth/workspace.js";
import { createProjectAuthRoutes } from "../src/templates/project-auth/routes.js";
import {
  createAuthToken,
  listAuthTokens,
} from "../src/templates/project-auth/auth-tokens.js";

const emptyCatalog = createTableCatalog([]);

describe("project auth template", () => {
  let conn: ProjectDbConnection | null = null;

  afterEach(() => {
    conn?.sqlite.close();
    conn = null;
  });

  it("parses project auth runtime config from env", () => {
    expect(
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        SAPPORTA_FRONTEND_ORIGINS:
          "http://localhost:5173, http://localhost:5174",
        SAPPORTA_REQUIRE_VERIFIED_EMAIL: "false",
        SAPPORTA_HEALTH_POLICY: "authenticated",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toEqual({
      port: 3000,
      betterAuthSecret: "secret",
      publicBaseUrl: "http://localhost:5173",
      trustedOrigins: ["http://localhost:5173", "http://localhost:5174"],
      requireVerifiedEmail: false,
      healthPolicy: "authenticated",
      mail: {
        from: "Sapporta <no-reply@example.test>",
        transport: "stream",
      },
    });
  });

  it("trusts the public base URL origin", () => {
    expect(
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }).trustedOrigins,
    ).toEqual(["http://localhost:5173"]);
  });

  it("deduplicates the public base URL from extra frontend origins", () => {
    expect(
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        SAPPORTA_FRONTEND_ORIGINS:
          "http://localhost:5174, http://localhost:5173",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }).trustedOrigins,
    ).toEqual(["http://localhost:5173", "http://localhost:5174"]);
  });

  it("uses the configured API port", () => {
    expect(
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5174",
        PORT: "3001",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }).port,
    ).toBe(3001);
  });

  it("rejects malformed auth env values", () => {
    expect(() =>
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173/path",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toThrow(/SAPPORTA_PUBLIC_BASE_URL must contain origins only/);

    expect(() =>
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        SAPPORTA_REQUIRE_VERIFIED_EMAIL: "no",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toThrow(/SAPPORTA_REQUIRE_VERIFIED_EMAIL/);

    expect(() =>
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        SAPPORTA_FRONTEND_ORIGINS: "http://localhost:5173x",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toThrow(/SAPPORTA_FRONTEND_ORIGINS/);

    expect(() =>
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        PORT: "3001x",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toThrow(/PORT/);

    expect(() =>
      readProjectAuthEnv({
        BETTER_AUTH_SECRET: "secret",
        SAPPORTA_PUBLIC_BASE_URL: "http://localhost:5173",
        PORT: "abc",
        SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
      }),
    ).toThrow(/PORT/);
  });

  it("resolves an anonymous context when better-auth has no session", async () => {
    conn = createAuthDb();
    const auth = sessionApi(null);

    const context = await resolveSapportaAuthContext({
      auth,
      conn,
      catalog: emptyCatalog,
      headers: new Headers(),
      c: requestContext(),
      buildAbility: buildAppAbility,
      resolveRowsAllowedForRequest,
    });

    expect(context.principal).toEqual({ kind: "anonymous" });
    expect(context.rowsAllowedForRequest).toEqual({ kind: "allowOnlySystemWideRows" });
  });

  it("builds context from the active organization membership", async () => {
    conn = createAuthDb();
    insertSession(conn, "session-1", "user-1", "workspace-1");
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "admin", 1);

    const context = await resolveSapportaAuthContext({
      auth: sessionApi(sessionPayload({ activeOrganizationId: "workspace-1" })),
      conn,
      catalog: emptyCatalog,
      headers: new Headers(),
      c: requestContext(),
      buildAbility: buildAppAbility,
      resolveRowsAllowedForRequest,
    });

    expect(context).toMatchObject({
      principal: {
        kind: "user",
        user: { id: "user-1", email: "owner@example.test" },
        membership: {
          id: "member-1",
          workspace: {
            id: "workspace-1",
            name: "Acme",
            slug: "acme",
          },
          roles: ["owner"],
        },
      },
      rowsAllowedForRequest: { kind: "allowWorkspaceUserRows" },
    });
  });

  it("builds context from a valid bearer token before session auth", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const created = createAuthToken(conn, routeUserPrincipal(), {
      name: "codex-local",
    });

    const context = await resolveSapportaAuthContext({
      auth: sessionApi(null),
      conn,
      catalog: emptyCatalog,
      headers: new Headers({ authorization: `Bearer ${created.rawToken}` }),
      c: requestContext(),
      buildAbility: buildAppAbility,
      resolveRowsAllowedForRequest,
    });

    expect(context).toMatchObject({
      principal: {
        kind: "user",
        user: { id: "user-1", email: "owner@example.test" },
        membership: {
          workspace: { id: "workspace-1", slug: "acme" },
          roles: ["owner"],
        },
      },
      rowsAllowedForRequest: { kind: "allowWorkspaceUserRows" },
    });
    expect(readTokenLastUsedAt(conn, created.token.id)).toEqual(expect.any(Number));
  });

  it("rejects expired and revoked bearer tokens with stable codes", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const expired = createAuthToken(conn, routeUserPrincipal(), {
      name: "expired",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const revoked = createAuthToken(conn, routeUserPrincipal(), {
      name: "revoked",
    });
    conn.sqlite
      .prepare("UPDATE personalAccessToken SET revokedAt = ? WHERE id = ?")
      .run(Date.now(), revoked.token.id);

    await expectTokenFailure(conn, expired.rawToken, "token_expired");
    await expectTokenFailure(conn, revoked.rawToken, "token_revoked");
  });

  it("rejects unknown bearer tokens with the unauthenticated code", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });

    await expectTokenFailure(conn, "spat_missing-token_secret", "unauthenticated");
  });

  it("rejects bearer tokens after workspace membership is removed", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const created = createAuthToken(conn, routeUserPrincipal(), {
      name: "codex-local",
    });
    conn.sqlite.prepare("DELETE FROM member WHERE id = ?").run("member-1");

    await expectTokenFailure(conn, created.rawToken, "workspace_required");
  });

  it("resolves separate workspace tokens to separate row-security contexts", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertWorkspace(conn, "workspace-2", "Second", "second");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    insertMember(conn, "member-2", "workspace-2", "user-1", "member", 2);
    const firstToken = createAuthToken(conn, routeUserPrincipal(), {
      name: "workspace-1",
    });
    const secondToken = createAuthToken(
      conn,
      routeUserPrincipal({ role: "member", workspaceId: "workspace-2" }),
      { name: "workspace-2" },
    );

    const firstContext = await resolveTokenAuthContext(conn, firstToken.rawToken);
    const secondContext = await resolveTokenAuthContext(conn, secondToken.rawToken);

    expect(firstContext).toMatchObject({
      principal: {
        kind: "user",
        membership: {
          workspace: { id: "workspace-1", slug: "acme" },
          roles: ["owner"],
        },
      },
      rowsAllowedForRequest: {
        workspace: { id: "workspace-1", slug: "acme" },
      },
    });
    expect(secondContext).toMatchObject({
      principal: {
        kind: "user",
        membership: {
          workspace: { id: "workspace-2", slug: "second" },
          roles: ["member"],
        },
      },
      rowsAllowedForRequest: {
        workspace: { id: "workspace-2", slug: "second" },
      },
    });
  });

  it("selects the first membership when the session has no active organization", () => {
    conn = createAuthDb();
    const payload = sessionPayload({ activeOrganizationId: null });
    insertSession(conn, "session-1", "user-1", null);
    insertWorkspace(conn, "workspace-2", "Second", "second");
    insertWorkspace(conn, "workspace-1", "First", "first");
    insertMember(conn, "member-2", "workspace-2", "user-1", "member", 2);
    insertMember(conn, "member-1", "workspace-1", "user-1", "member", 1);

    const membership = ensureActiveWorkspace(conn, payload);

    expect(membership.organization_id).toBe("workspace-1");
    expect(payload.session.activeOrganizationId).toBe("workspace-1");
    expect(readSessionWorkspace(conn, "session-1")).toBe("workspace-1");
  });

  it("provisions an initial workspace when the user has no membership", () => {
    conn = createAuthDb();
    const payload = sessionPayload({
      name: "Ada Lovelace",
      activeOrganizationId: null,
    });
    insertSession(conn, "session-1", "user-1", null);

    const membership = ensureActiveWorkspace(conn, payload);

    expect(membership.role).toBe("owner");
    expect(membership.organization_name).toBe("Ada Lovelace's Workspace");
    expect(membership.organization_slug).toBe("ada-lovelace-s-workspace");
    expect(readSessionWorkspace(conn, "session-1")).toBe(
      membership.organization_id,
    );
  });

  it("switches workspaces for a member", () => {
    conn = createAuthDb();
    const payload = sessionPayload({ activeOrganizationId: "workspace-1" });
    insertSession(conn, "session-1", "user-1", "workspace-1");
    insertWorkspace(conn, "workspace-1", "First", "first");
    insertWorkspace(conn, "workspace-2", "Second", "second");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    insertMember(conn, "member-2", "workspace-2", "user-1", "member", 2);

    const membership = switchWorkspaceMembership(conn, payload, "workspace-2");

    expect(membership.organization_id).toBe("workspace-2");
    expect(readSessionWorkspace(conn, "session-1")).toBe("workspace-2");
  });

  it("rejects workspace switching for a non-member", async () => {
    conn = createAuthDb();
    insertSession(conn, "session-1", "user-1", "workspace-1");
    insertWorkspace(conn, "workspace-1", "First", "first");
    insertWorkspace(conn, "workspace-2", "Second", "second");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);

    await expect(
      switchActiveWorkspace({
        auth: sessionApi(sessionPayload({ activeOrganizationId: "workspace-1" })),
        conn,
        catalog: emptyCatalog,
        headers: new Headers(),
        c: requestContext(),
        buildAbility: buildAppAbility,
        resolveRowsAllowedForRequest,
        workspaceId: "workspace-2",
      }),
    ).rejects.toBeInstanceOf(WorkspaceSwitchError);
  });

  it("returns Sapporta auth errors from generated routes", async () => {
    conn = createAuthDb();
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => {
        throw new WorkspaceSwitchError(
          "You are not a member of that workspace.",
        );
      },
    });
    const app = new Hono<SapportaEnv>();
    app.use("/api/*", async (c, next) => {
      c.set("auth", routeAuthContext());
      await next();
    });
    app.route("/api", routes);

    const response = await app.request("/api/auth-context/active-workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "workspace-2" }),
    });

    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
    expect(response.status).toBe(403);
  });

  it("returns the current auth context from generated routes", async () => {
    conn = createAuthDb();
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () =>
        routeAuthContext({ workspaceId: "workspace-2" }),
    });
    const app = new Hono<SapportaEnv>();
    app.use("/api/*", async (c, next) => {
      c.set("auth", routeAuthContext());
      await next();
    });
    app.route("/api", routes);

    const response = await app.request("/api/auth-context");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "user-1", email: "owner@example.test" },
      workspace: { id: "workspace-1", slug: "acme" },
      memberships: [
        expect.objectContaining({
          workspace: { id: "workspace-1", name: "Acme", slug: "acme" },
          role: "owner",
          isOwner: true,
        }),
      ],
    });
  });

  it("returns public auth bootstrap status from generated routes", async () => {
    conn = createAuthDb({ includeUserTable: true });
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = new Hono<SapportaEnv>();
    app.route("/api", routes);

    const emptyResponse = await app.request("/api/auth-bootstrap");

    expect(emptyResponse.status).toBe(200);
    await expect(emptyResponse.json()).resolves.toEqual({
      userCount: 0,
      workspaceCount: 0,
      isEmpty: true,
    });

    conn.sqlite
      .prepare(
        "INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, ?)",
      )
      .run("user-1", "Owner", "owner@example.test", 1);

    const responseWithUser = await app.request("/api/auth-bootstrap");

    expect(responseWithUser.status).toBe(200);
    await expect(responseWithUser.json()).resolves.toEqual({
      userCount: 1,
      workspaceCount: 0,
      isEmpty: false,
    });
  });

  it("creates and lists agent access token metadata from generated routes", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(routes);

    const createResponse = await app.request("/api/auth-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "codex-local" }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.rawToken).toMatch(/^spat_/);
    expect(created.token).toMatchObject({
      userId: "user-1",
      organizationId: "workspace-1",
      name: "codex-local",
      revokedAt: null,
    });
    expect(created.token.secretHash).toBeUndefined();

    const listResponse = await app.request("/api/auth-tokens");

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      tokens: [
        expect.objectContaining({
          id: created.token.id,
          name: "codex-local",
        }),
      ],
    });
    expect(listAuthTokens(conn, "user-1")[0]).not.toHaveProperty("secretHash");
  });

  it("allows non-owner users to manage their own agent access tokens", () => {
    const memberAuth = routeAuthContext({ role: "member" });
    const ability = buildTemplateAbility({
      principal: memberAuth.principal,
      rowsAllowedForRequest: memberAuth.rowsAllowedForRequest,
    });

    expect(ability.can("read", "agent_access_token")).toBe(true);
    expect(ability.can("create", "agent_access_token")).toBe(true);
    expect(ability.can("delete", "agent_access_token")).toBe(true);
  });

  it("rejects token management without user-scoped workspace rows", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Member", "member@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "member", 1);
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(routes, routeWorkspaceWideContext());

    const response = await app.request("/api/auth-tokens");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
  });

  it("requires token-management ability before reading, creating, or revoking tokens", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const created = createAuthToken(conn, routeUserPrincipal(), {
      name: "codex-local",
    });
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(
      routes,
      routeAuthContext({
        can: (action, subject) =>
          !(subject === "agent_access_token" && action !== "manage"),
      }),
    );

    const listResponse = await app.request("/api/auth-tokens");
    const createResponse = await app.request("/api/auth-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "codex-local" }),
    });
    const revokeResponse = await app.request(
      `/api/auth-tokens/${created.token.id}`,
      { method: "DELETE" },
    );

    expect(listResponse.status).toBe(403);
    await expect(listResponse.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
    expect(createResponse.status).toBe(403);
    await expect(createResponse.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
    expect(revokeResponse.status).toBe(403);
    await expect(revokeResponse.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
  });

  it("limits token management routes to the current workspace scope", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertWorkspace(conn, "workspace-2", "Second", "second");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    insertMember(conn, "member-2", "workspace-2", "user-1", "owner", 2);
    const workspaceOneToken = createAuthToken(conn, routeUserPrincipal(), {
      name: "workspace-one",
    });
    const workspaceTwoToken = createAuthToken(
      conn,
      routeUserPrincipal({ workspaceId: "workspace-2" }),
      { name: "workspace-two" },
    );
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(
      routes,
      routeAuthContext({ workspaceId: "workspace-1" }),
    );

    const listResponse = await app.request("/api/auth-tokens");
    const crossWorkspaceCreateResponse = await app.request("/api/auth-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "workspace-two-from-workspace-one",
        organizationId: "workspace-2",
      }),
    });
    const crossWorkspaceRevokeResponse = await app.request(
      `/api/auth-tokens/${workspaceTwoToken.token.id}`,
      { method: "DELETE" },
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      tokens: [
        expect.objectContaining({
          id: workspaceOneToken.token.id,
          organizationId: "workspace-1",
        }),
      ],
    });
    expect(crossWorkspaceCreateResponse.status).toBe(403);
    expect(crossWorkspaceRevokeResponse.status).toBe(404);
    expect(listAuthTokens(conn, "user-1")).toHaveLength(2);
  });

  it("revokes only tokens owned by the signed-in user", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertUser(conn, "user-2", "Other", "other@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    insertMember(conn, "member-2", "workspace-1", "user-2", "member", 2);
    const ownToken = createAuthToken(conn, routeUserPrincipal(), {
      name: "own",
    });
    const otherToken = createAuthToken(
      conn,
      routeUserPrincipal({ userId: "user-2", role: "member" }),
      { name: "other" },
    );
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(routes);

    const forbiddenResponse = await app.request(
      `/api/auth-tokens/${otherToken.token.id}`,
      { method: "DELETE" },
    );
    const ownResponse = await app.request(
      `/api/auth-tokens/${ownToken.token.id}`,
      { method: "DELETE" },
    );

    expect(forbiddenResponse.status).toBe(404);
    expect(ownResponse.status).toBe(204);
    expect(listAuthTokens(conn, "user-1")[0].revokedAt).not.toBeNull();
  });

  it("does not let bearer tokens manage agent access tokens", async () => {
    conn = createAuthDb({ includeUserTable: true, includeTokenTable: true });
    insertUser(conn, "user-1", "Owner", "owner@example.test", true);
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "owner", 1);
    const routes = createProjectAuthRoutes({
      conn,
      switchActiveWorkspace: async () => routeAuthContext(),
    });
    const app = authRoutesApp(routes);

    const response = await app.request("/api/auth-tokens", {
      headers: { authorization: "Bearer spat_token_secret" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
  });

  it("auth resolver sets anonymous auth context when session is missing", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      resolveProjectAuthMiddleware(() => routeAnonymousContext()),
    );
    app.get("/api/private", (c) => c.json(c.get("auth").principal));

    const response = await app.request("/api/private");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "anonymous" });
  });

  it("anonymous gate rejects private routes by default", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      resolveProjectAuthMiddleware(() => routeAnonymousContext()),
    );
    app.use("/api/*", rejectAnonymousByDefault());
    app.get("/api/private", (c) => c.json({ ok: true }));

    const response = await app.request("/api/private");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
      code: "unauthenticated",
    });
  });

  it("anonymous gate allows explicit public routes", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      resolveProjectAuthMiddleware(() => routeAnonymousContext()),
    );
    app.use(
      "/api/*",
      rejectAnonymousByDefault({
        publicRoutes: [{ method: "GET", path: "/api/public" }],
      }),
    );
    app.get("/api/public", (c) => c.json({ public: true }));
    app.get("/api/private", (c) => c.json({ ok: true }));

    const publicResponse = await app.request("/api/public");
    const privateResponse = await app.request("/api/private");

    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toEqual({ public: true });
    expect(privateResponse.status).toBe(401);
  });

  it("requireVerifiedUser enforces verified email", async () => {
    const app = new Hono<SapportaEnv>();
    app.use("*", async (c, next) => {
      c.set("auth", routeAuthContext({ emailVerified: false }));
      await next();
    });
    app.get("/api/private", (c) => c.json(requireVerifiedUser(c)));

    const response = await app.request("/api/private");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Email verification required",
      code: "email_not_verified",
    });
  });

  it("requireWorkspaceRowsAllowed accepts workspace row access", async () => {
    const app = new Hono<SapportaEnv>();
    app.use("*", async (c, next) => {
      c.set("auth", routeAuthContext());
      await next();
    });
    app.get("/api/private", (c) =>
      c.json(requireWorkspaceRowsAllowed(c).rowsAllowedForRequest.workspace),
    );

    const response = await app.request("/api/private");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "workspace-1",
      name: "Acme",
    });
  });

  it("requireWorkspaceOwner accepts owner and admin mapped users", async () => {
    const ownerApp = guardedApp(routeAuthContext({ role: "owner" }));
    const adminMappedApp = guardedApp(routeAuthContext({ role: "admin" }));

    expect((await ownerApp.request("/api/private")).status).toBe(200);
    expect((await adminMappedApp.request("/api/private")).status).toBe(200);
  });

  it("requireWorkspaceOwner rejects non-owner users", async () => {
    const app = guardedApp(routeAuthContext({ role: "member" }));

    const response = await app.request("/api/private");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
  });
});

function createAuthDb(
  options: { includeUserTable?: boolean; includeTokenTable?: boolean } = {},
): ProjectDbConnection {
  const db = connectProject(":memory:");
  db.sqlite.exec(`
    -- Minimal fixture for Better Auth's session table. The real project-auth
    -- schema stores token/expiry/client metadata too; these tests only need
    -- the session id, user id, and active organization workspace pointer.
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      activeOrganizationId TEXT,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE organization (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      logo TEXT,
      createdAt INTEGER NOT NULL,
      metadata TEXT
    );
    CREATE TABLE member (
      id TEXT PRIMARY KEY,
      organizationId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
  if (options.includeUserTable === true) {
    db.sqlite.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        emailVerified INTEGER NOT NULL
      );
    `);
  }
  if (options.includeTokenTable === true) {
    db.sqlite.exec(`
      CREATE TABLE personalAccessToken (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        organizationId TEXT NOT NULL,
        name TEXT NOT NULL,
        secretHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER,
        lastUsedAt INTEGER,
        revokedAt INTEGER
      );
    `);
  }
  return db;
}

function sessionApi(
  payload: BetterAuthSessionPayload | null,
): BetterAuthSessionApi {
  return {
    getSession: async () => payload,
  };
}

function sessionPayload(
  overrides: {
    name?: string | null;
    activeOrganizationId?: string | null;
  } = {},
): BetterAuthSessionPayload {
  return {
    session: {
      id: "session-1",
      userId: "user-1",
      activeOrganizationId: overrides.activeOrganizationId,
    },
    user: {
      id: "user-1",
      name: overrides.name === undefined ? "Owner" : overrides.name,
      email: "owner@example.test",
      emailVerified: true,
    },
  };
}

function insertSession(
  db: ProjectDbConnection,
  id: string,
  userId: string,
  workspaceId: string | null,
): void {
  db.sqlite
    .prepare(
      "INSERT INTO session (id, userId, activeOrganizationId, updatedAt) VALUES (?, ?, ?, 1)",
    )
    .run(id, userId, workspaceId);
}

function insertUser(
  db: ProjectDbConnection,
  id: string,
  name: string,
  email: string,
  emailVerified: boolean,
): void {
  db.sqlite
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, ?)",
    )
    .run(id, name, email, emailVerified ? 1 : 0);
}

function insertWorkspace(
  db: ProjectDbConnection,
  id: string,
  name: string,
  slug: string,
): void {
  db.sqlite
    .prepare(
      "INSERT INTO organization (id, name, slug, logo, createdAt, metadata) VALUES (?, ?, ?, NULL, 1, NULL)",
    )
    .run(id, name, slug);
}

function insertMember(
  db: ProjectDbConnection,
  id: string,
  workspaceId: string,
  userId: string,
  role: string,
  createdAt: number,
): void {
  db.sqlite
    .prepare(
      "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, workspaceId, userId, role, createdAt);
}

function readSessionWorkspace(
  db: ProjectDbConnection,
  sessionId: string,
): string | null {
  const row = db.sqlite
    .prepare("SELECT activeOrganizationId FROM session WHERE id = ?")
    .get(sessionId);
  if (!isRecord(row)) return null;
  const value = row.activeOrganizationId;
  return typeof value === "string" ? value : null;
}

function readTokenLastUsedAt(
  db: ProjectDbConnection,
  tokenId: string,
): number | null {
  const row = db.sqlite
    .prepare("SELECT lastUsedAt FROM personalAccessToken WHERE id = ?")
    .get(tokenId);
  if (!isRecord(row)) return null;
  const value = row.lastUsedAt;
  return typeof value === "number" ? value : null;
}

async function resolveTokenAuthContext(
  db: ProjectDbConnection,
  rawToken: string,
): Promise<SapportaAuthContext<AppAbility, AppWorkspaceMembership>> {
  return resolveSapportaAuthContext({
    auth: sessionApi(null),
    conn: db,
    catalog: emptyCatalog,
    headers: new Headers({ authorization: `Bearer ${rawToken}` }),
    c: requestContext(),
    buildAbility: buildAppAbility,
    resolveRowsAllowedForRequest,
  });
}

async function expectTokenFailure(
  db: ProjectDbConnection,
  rawToken: string,
  code: string,
): Promise<void> {
  try {
    await resolveTokenAuthContext(db, rawToken);
    throw new Error("Expected token auth to fail.");
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    if (!(err instanceof HTTPException)) return;
    expect(err.status).toBe(code === "workspace_required" ? 403 : 401);
    await expect(err.getResponse().json()).resolves.toMatchObject({ code });
  }
}

function authRoutesApp(
  routes: ReturnType<typeof createProjectAuthRoutes>,
  auth: SapportaAuthContext<AppAbility, AppWorkspaceMembership> = routeAuthContext(),
): Hono<SapportaEnv> {
  const app = new Hono<SapportaEnv>();
  app.use("/api/*", async (c, next) => {
    c.set("auth", auth);
    await next();
  });
  app.route("/api", routes);
  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function guardedApp(auth: SapportaAuthContext): Hono<SapportaEnv> {
  const app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", auth);
    await next();
  });
  app.get("/api/private", (c) =>
    c.json({ workspaceId: requireWorkspaceOwner(c).rowsAllowedForRequest.workspace.id }),
  );
  return app;
}

function routeAuthContext(
  overrides: {
    role?: string;
    emailVerified?: boolean;
    workspaceId?: string;
    userId?: string;
    can?: (action: string, subject: string) => boolean;
  } = {},
): SapportaAuthContext<AppAbility, AppWorkspaceMembership> {
  const storedRole = overrides.role ?? "owner";
  const role = storedRole === "owner" || storedRole === "admin" ? "owner" : "member";
  const workspaceId = overrides.workspaceId ?? "workspace-1";
  const user = {
    id: overrides.userId ?? "user-1",
    name: "Owner",
    email: "owner@example.test",
    emailVerified: overrides.emailVerified ?? true,
  };
  const workspace = {
    id: workspaceId,
    name: "Acme",
    slug: "acme",
  };

  const principal = {
      kind: "user",
      user,
      membership: {
        id: "member-1",
        workspace,
        roles: [role],
      },
    } as const;
  const rowsAllowedForRequest = {
      kind: "allowWorkspaceUserRows",
      workspace,
      user,
    } as const satisfies RowsAllowedForRequest;

  return createAuthContext({
    principal,
    rowsAllowedForRequest,
    ability: {
      can: overrides.can ?? (() => true),
    } as unknown as AppAbility,
    catalog: emptyCatalog,
  });
}

function routeUserPrincipal(
  overrides: {
    role?: string;
    emailVerified?: boolean;
    workspaceId?: string;
    userId?: string;
  } = {},
): Extract<
  SapportaAuthContext<AppAbility, AppWorkspaceMembership>["principal"],
  { kind: "user" }
> {
  const principal = routeAuthContext(overrides).principal;
  if (principal.kind !== "user") {
    throw new Error("Expected a user principal.");
  }
  return principal;
}

function routeAnonymousContext(): SapportaAuthContext<AppAbility, AppWorkspaceMembership> {
  const principal = { kind: "anonymous" } as const;
  const rowsAllowedForRequest = allowOnlySystemWideRows();
  return createAuthContext({
    principal,
    rowsAllowedForRequest,
    ability: buildAppAbility({ principal, rowsAllowedForRequest }),
    catalog: emptyCatalog,
  });
}

function routeWorkspaceWideContext(): SapportaAuthContext<
  AppAbility,
  AppWorkspaceMembership
> {
  const user = {
    id: "user-1",
    name: "Member",
    email: "member@example.test",
    emailVerified: true,
  };
  const workspace = {
    id: "workspace-1",
    name: "Acme",
    slug: "acme",
  };
  const principal = {
    kind: "user",
    user,
    membership: {
      id: "member-1",
      workspace,
      roles: ["member"],
    },
  } as const;
  const rowsAllowedForRequest = allowWorkspaceWideRows(workspace);
  return createAuthContext({
    principal,
    rowsAllowedForRequest,
    ability: {
      can: () => true,
    } as unknown as AppAbility,
    catalog: emptyCatalog,
  });
}

const buildAppAbility: BuildAbility<AppAbility, AppWorkspaceMembership> = () =>
  ({ can: () => true }) as unknown as AppAbility;

const resolveRowsAllowedForRequest: ResolveRowsAllowedForRequest = async ({ principal }) => {
  if (principal.kind !== "user") return allowOnlySystemWideRows();
  return {
    kind: "allowWorkspaceUserRows",
    workspace: principal.membership.workspace,
    user: principal.user,
  };
};

function requestContext(): Parameters<ResolveRowsAllowedForRequest>[0]["c"] {
  return {} as Parameters<ResolveRowsAllowedForRequest>[0]["c"];
}
