/**
 * Shared harness for single-project integration tests.
 *
 * Builds a Hono app with the framework + the accounts fixture mounted at
 * /api on an in-memory SQLite database, so each test file gets full
 * isolation.
 */
import { Hono } from "hono";
import {
  installSapportaRequestContext,
  loadSapportaProject,
  mountOpenApi,
  mountSapportaFramework,
} from "../project/load-sapporta.js";
import {
  createAuthContext,
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  type SapportaAuthContext,
  type SapportaAbility,
  type WorkspaceRole,
  workspaceGlobalOnlyAuthority,
  workspaceUserScopedAuthority,
} from "../auth/index.js";
import { createTestDb } from "../testing/test-utils.js";
import { installSapportaDefaults, type SapportaEnv } from "../api/server.js";
import { TsRestApi } from "../api/index.js";
import { resolve, join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { TableCatalog } from "../schema/catalog.js";

// Compiled fixtures, rebuilt by the root `pretest` script. See
// packages/core/tsconfig.fixtures.json for the output layout.
const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../fixtures-dist/integration/fixtures",
);
const FIXTURES_SOURCE_DIR = resolve(import.meta.dirname, "fixtures");

// Module-scoped so the request helpers below don't need to thread it.
let app: Hono<SapportaEnv>;

const TEST_AUTH_HEADER = "x-sapporta-test-auth";
const UNRESTRICTED_META_SUBJECT = "sapporta_unrestricted_access";

export interface TestAuthOverrides {
  sessionId?: string;
  userId?: string;
  userName?: string | null;
  userEmail?: string;
  emailVerified?: boolean;
  workspaceId?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  isOwner?: boolean;
  canManageUnrestrictedAccess?: boolean;
  memberId?: string;
  role?: WorkspaceRole;
  deniedAbilities?: TestDeniedAbility[];
}

export interface TestDeniedAbility {
  action: string;
  subject: string;
}

export type TestRequestInit = RequestInit & {
  auth?: TestAuthOverrides;
};

export async function createIntegrationApp(
  options: {
    installDefaults?: boolean;
    configureApi?: (api: TsRestApi<SapportaEnv>) => void;
  } = {},
): Promise<{
  app: Hono<SapportaEnv>;
  conn: ReturnType<typeof createTestDb>;
}> {
  const conn = createTestDb();
  migrate(conn.db, {
    migrationsFolder: join(FIXTURES_SOURCE_DIR, "packages/api/migrations"),
  });

  app = new Hono<SapportaEnv>();
  if (options.installDefaults !== false) {
    installSapportaDefaults(app);
  }

  // accountsApi comes from the compiled fixture bundle — a separate
  // module instance than this file's `TsRestApi`. All merging goes
  // through `extend()`'s structural duck typing.
  const apiApp = new TsRestApi<SapportaEnv>();
  const accountsModule = await import(join(FIXTURES_DIR, "app/accounts.js"));
  apiApp.route("/", accountsModule.default);
  apiApp.extend(accountsModule.default);
  options.configureApi?.(apiApp);

  const sapporta = await loadSapportaProject({
    name: "Test",
    slug: "test",
    projectRoot: FIXTURES_SOURCE_DIR,
    apiDistDir: FIXTURES_DIR,
    conn,
  });

  installSapportaRequestContext(app, conn);
  app.use("/api/*", async (c, next) => {
    c.set(
      "auth",
      createTestAuth(readAuthOverrides(c.req.raw), sapporta.catalog),
    );
    return next();
  });
  const sapportaApi = mountSapportaFramework(app, sapporta, {
    conn,
    auth: {
      requireAuthContext: (c) => c.get("auth"),
    },
  });
  app.route("/api", apiApp);
  mountOpenApi(app, sapporta, sapportaApi, apiApp);

  return { app, conn };
}

/** Make a GET request to the test app. */
export function request(path: string, init: TestRequestInit = {}) {
  return app.request(path, requestInitWithAuth(init));
}

/** POST JSON body to the test app. */
export function postJson(
  path: string,
  body: unknown,
  auth?: TestAuthOverrides,
) {
  return app.request(
    path,
    requestInitWithAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      auth,
    }),
  );
}

/** PUT JSON body to the test app. */
export function putJson(path: string, body: unknown, auth?: TestAuthOverrides) {
  return app.request(
    path,
    requestInitWithAuth({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      auth,
    }),
  );
}

/** PATCH JSON body to the test app. */
export function patchJson(
  path: string,
  body: unknown,
  auth?: TestAuthOverrides,
) {
  return app.request(
    path,
    requestInitWithAuth({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      auth,
    }),
  );
}

/** DELETE request to the test app. Optionally appends a query string. */
export function del(path: string, query?: string, auth?: TestAuthOverrides) {
  const url = query ? `${path}?${query}` : path;
  return app.request(url, requestInitWithAuth({ method: "DELETE", auth }));
}

export function asAuth(auth: TestAuthOverrides): {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  postJson: (path: string, body: unknown) => Response | Promise<Response>;
  putJson: (path: string, body: unknown) => Response | Promise<Response>;
  patchJson: (path: string, body: unknown) => Response | Promise<Response>;
  del: (path: string, query?: string) => Response | Promise<Response>;
} {
  return {
    request: (path, init = {}) => request(path, { ...init, auth }),
    postJson: (path, body) => postJson(path, body, auth),
    putJson: (path, body) => putJson(path, body, auth),
    patchJson: (path, body) => patchJson(path, body, auth),
    del: (path, query) => del(path, query, auth),
  };
}

function createTestAuth(
  overrides: TestAuthOverrides,
  catalog: TableCatalog,
): SapportaAuthContext {
  const userId = overrides.userId ?? "user-1";
  const workspaceId = overrides.workspaceId ?? "workspace-1";
  const user = {
    id: userId,
    name: overrides.userName ?? "Test User",
    email: overrides.userEmail ?? `${userId}@example.com`,
    emailVerified: overrides.emailVerified ?? true,
  };
  const workspace = {
    id: workspaceId,
    name: overrides.workspaceName ?? `Workspace ${workspaceId}`,
    slug: overrides.workspaceSlug ?? workspaceId,
  };
  const roles = [
    overrides.role ?? (overrides.isOwner === false ? "member" : "owner"),
  ];

  return createAuthContext({
    principal: {
      kind: "user",
      user,
      membership: {
        id: overrides.memberId ?? `member-${userId}-${workspaceId}`,
        roles,
      },
    },
    dataAuthority: requestDataAuthority({
      systemGlobalOnly: systemGlobalOnlyAuthority(),
      workspaceGlobalOnly: workspaceGlobalOnlyAuthority(workspace),
      workspaceUserScoped: workspaceUserScopedAuthority({
        workspace,
        user,
      }),
    }),
    ability: allowAllAbility({
      canManageUnrestrictedAccess:
        overrides.canManageUnrestrictedAccess ?? roles.includes("owner"),
      deniedAbilities: overrides.deniedAbilities ?? [],
    }),
    catalog,
  });
}

function allowAllAbility(options: {
  canManageUnrestrictedAccess: boolean;
  deniedAbilities: readonly TestDeniedAbility[];
}): SapportaAbility {
  return {
    can: (action, subject) => {
      if (
        options.deniedAbilities.some(
          (denied) => denied.action === action && denied.subject === subject,
        )
      ) {
        return false;
      }
      if (action === "manage" && subject === UNRESTRICTED_META_SUBJECT) {
        return options.canManageUnrestrictedAccess;
      }
      return true;
    },
  };
}

function requestInitWithAuth(init: TestRequestInit): RequestInit {
  const { auth, ...requestInit } = init;
  if (!auth) return requestInit;

  const headers = new Headers(requestInit.headers);
  headers.set(TEST_AUTH_HEADER, JSON.stringify(auth));
  return { ...requestInit, headers };
}

function readAuthOverrides(request: Request): TestAuthOverrides {
  const raw = request.headers.get(TEST_AUTH_HEADER);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${TEST_AUTH_HEADER} must contain a JSON object.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
