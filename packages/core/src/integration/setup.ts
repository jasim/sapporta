/**
 * Shared harness for single-project integration tests.
 *
 * Builds a Hono app with the framework + the accounts fixture mounted at
 * /api on an in-memory SQLite database, so each test file gets full
 * isolation.
 */
import { Hono } from "hono";
import { loadSapporta, mountOpenApi } from "../load-sapporta.js";
import { createTestDb } from "../testing/test-utils.js";
import type { SapportaEnv } from "../api/server.js";
import { TsRestApi } from "../api/index.js";
import { resolve, join } from "node:path";

// Compiled fixtures, rebuilt by the root `pretest` script. See
// packages/core/tsconfig.fixtures.json for the output layout.
const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../fixtures-dist/integration/fixtures",
);

// Module-scoped so the request helpers below don't need to thread it.
let app: Hono<SapportaEnv>;

export async function createIntegrationApp(): Promise<{
  app: Hono<SapportaEnv>;
}> {
  const conn = createTestDb();

  app = new Hono<SapportaEnv>();

  // accountsApi comes from the compiled fixture bundle — a separate
  // module instance than this file's `TsRestApi`. All merging goes
  // through `extend()`'s structural duck typing.
  const apiApp = new TsRestApi<SapportaEnv>();
  const accountsModule = await import(join(FIXTURES_DIR, "app/accounts.js"));
  apiApp.route("/", accountsModule.default);
  apiApp.extend(accountsModule.default);

  const sapporta = await loadSapporta(app, {
    slug: "test",
    apiDistDir: FIXTURES_DIR,
    conn,
  });
  app.route("/api", apiApp);
  mountOpenApi(app, sapporta, apiApp);

  return { app };
}

/** Make a GET request to the test app. */
export function request(path: string, init?: RequestInit) {
  return app.request(path, init);
}

/** POST JSON body to the test app. */
export function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** PUT JSON body to the test app. */
export function putJson(path: string, body: unknown) {
  return app.request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** PATCH JSON body to the test app. */
export function patchJson(path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** DELETE request to the test app. Optionally appends a query string. */
export function del(path: string, query?: string) {
  const url = query ? `${path}?${query}` : path;
  return app.request(url, { method: "DELETE" });
}
