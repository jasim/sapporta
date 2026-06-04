import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  connectProject,
  createTableCatalog,
  type ProjectDbConnection,
  type SapportaAuthContext,
  type SapportaEnv,
} from "@sapporta/server";
import type { BetterAuthSessionApi } from "../src/templates/project-auth/better-auth.js";
import {
  authContextFromPayload,
  resolveSapportaAuthContext,
  switchActiveWorkspace,
  type BetterAuthSessionPayload,
} from "../src/templates/project-auth/context.js";
import {
  createProjectAuthMiddleware,
  requireWorkspaceOwner,
  requireWorkspaceUser,
} from "../src/templates/project-auth/middleware.js";
import { readProjectAuthEnv } from "../src/templates/project-auth/env.js";
import {
  WorkspaceSwitchError,
  ensureActiveWorkspace,
  switchWorkspaceMembership,
} from "../src/templates/project-auth/workspace.js";
import { createProjectAuthRoutes } from "../src/templates/project-auth/routes.js";

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

  it("returns null when better-auth has no session", async () => {
    conn = createAuthDb();
    const auth = sessionApi(null);

    await expect(
      resolveSapportaAuthContext(auth, conn, emptyCatalog, new Headers()),
    ).resolves.toBeNull();
  });

  it("builds context from the active organization membership", async () => {
    conn = createAuthDb();
    insertSession(conn, "session-1", "user-1", "workspace-1");
    insertWorkspace(conn, "workspace-1", "Acme", "acme");
    insertMember(conn, "member-1", "workspace-1", "user-1", "admin", 1);

    const context = await resolveSapportaAuthContext(
      sessionApi(sessionPayload({ activeOrganizationId: "workspace-1" })),
      conn,
      emptyCatalog,
      new Headers(),
    );

    expect(context).toMatchObject({
      session: {
        id: "session-1",
        userId: "user-1",
        activeWorkspaceId: "workspace-1",
      },
      workspace: {
        id: "workspace-1",
        name: "Acme",
        slug: "acme",
        isOwner: true,
      },
      member: { id: "member-1", role: "owner" },
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
      switchActiveWorkspace(
        sessionApi(sessionPayload({ activeOrganizationId: "workspace-1" })),
        conn,
        emptyCatalog,
        new Headers(),
        "workspace-2",
      ),
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

  it("middleware returns unauthenticated when session is missing", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      createProjectAuthMiddleware(() => null),
    );
    app.get("/api/private", (c) => c.json({ ok: true }));

    const response = await app.request("/api/private");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
      code: "unauthenticated",
    });
  });

  it("middleware enforces verified-email policy when configured", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      createProjectAuthMiddleware(
        () => routeAuthContext({ emailVerified: false }),
        { requireVerifiedEmail: true },
      ),
    );
    app.get("/api/private", (c) => c.json({ ok: true }));

    const response = await app.request("/api/private");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Email verification required",
      code: "email_not_verified",
    });
  });

  it("middleware skips public auth routes", async () => {
    const app = new Hono<SapportaEnv>();
    app.use(
      "/api/*",
      createProjectAuthMiddleware(() => null, {
        skip: (c) => c.req.path.startsWith("/api/auth/"),
      }),
    );
    app.get("/api/auth/session", (c) => c.json({ public: true }));
    app.get("/api/private", (c) => c.json({ ok: true }));

    const publicResponse = await app.request("/api/auth/session");
    const privateResponse = await app.request("/api/private");

    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toEqual({ public: true });
    expect(privateResponse.status).toBe(401);
  });

  it("requireWorkspaceUser accepts an active workspace context", async () => {
    const app = new Hono<SapportaEnv>();
    app.use("*", async (c, next) => {
      c.set("auth", routeAuthContext());
      await next();
    });
    app.get("/api/private", (c) => c.json(requireWorkspaceUser(c).workspace));

    const response = await app.request("/api/private");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "workspace-1",
      name: "Acme",
    });
  });

  it("requireWorkspaceOwner accepts owner and admin mapped users", async () => {
    const ownerApp = guardedApp(
      routeAuthContext({ role: "owner", isOwner: true }),
    );
    const adminMappedApp = guardedApp(
      routeAuthContext({ role: "admin", isOwner: true }),
    );

    expect((await ownerApp.request("/api/private")).status).toBe(200);
    expect((await adminMappedApp.request("/api/private")).status).toBe(200);
  });

  it("requireWorkspaceOwner rejects non-owner users", async () => {
    const app = guardedApp(
      routeAuthContext({ role: "member", isOwner: false }),
    );

    const response = await app.request("/api/private");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      code: "forbidden",
    });
  });
});

function createAuthDb(
  options: { includeUserTable?: boolean } = {},
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
    c.json({ workspaceId: requireWorkspaceOwner(c).workspace.id }),
  );
  return app;
}

function routeAuthContext(
  overrides: {
    role?: string;
    isOwner?: boolean;
    emailVerified?: boolean;
    workspaceId?: string;
  } = {},
): SapportaAuthContext {
  const role = overrides.role ?? "owner";
  const workspaceId = overrides.workspaceId ?? "workspace-1";
  const payload = sessionPayload({ activeOrganizationId: workspaceId });
  if (overrides.emailVerified !== undefined) {
    payload.user.emailVerified = overrides.emailVerified;
  }
  const auth = authContextFromPayload(
    payload,
    {
      member_id: "member-1",
      role,
      organization_id: workspaceId,
      organization_name: "Acme",
      organization_slug: "acme",
    },
    emptyCatalog,
  );
  return overrides.isOwner === undefined
    ? auth
    : { ...auth, workspace: { ...auth.workspace, isOwner: overrides.isOwner } };
}
