/**
 * Framework boot for projects that own their entry point.
 *
 * The public boot functions are intentionally small so project-owned
 * `boot.ts` files show the app's real startup order:
 *
 *   1. `loadSapportaProject(opts)` — load schemas/reports and verify DB
 *      migrations. It does not mutate the Hono app.
 *   2. Project auth can now boot with the loaded table definitions.
 *   3. `installSapportaRequestContext(app, conn)` — expose db/sqlite to
 *      request handlers.
 *   4. `mountSapportaFramework(app, project, opts)` — mount
 *      /api/meta, /api/tables, and /api/reports.
 *   5. `mountOpenApi(...)` — publish /api/openapi.json after every route is
 *      registered.
 */

import type { Hono } from "hono";
import {
  installFrameworkRoutePolicy,
  type SapportaAuthGuard,
  type SapportaEnv,
} from "./api/server.js";
import type { ProjectDbConnection } from "./db/sqlite-connection.js";
import type { ReportDefinition } from "./reports/report.js";
import type { TableDef } from "./schema/table.js";
import { fromApiCodeDir } from "./project-paths.js";
import { createTableCatalog, type TableCatalog } from "./schema/catalog.js";
import { loadSchemas } from "./schema/loader.js";
import { assertMigrationsReady } from "./migrations/guard.js";
import { loadReports } from "./reports/loader.js";
import {
  TsRestApi,
  mountMeta,
  mountTables,
  mountReports,
  makeMetaHandlers,
  makeWorkspaceSafeTableHandlers,
  makeReportHandlers,
} from "./api/index.js";

export interface LoadSapportaProjectOptions {
  /** Human-readable project name shown in the frontend chrome and auth pages. */
  name: string;
  slug: string;
  /** Absolute path to the project root containing sapporta.json. */
  projectRoot: string;
  /**
   * Absolute path to the project's compiled `packages/api/dist/` (with
   * `schema/` and `reports/` subdirectories). Schemas and reports load from here at
   * runtime; `tsc --watch` keeps it fresh during development.
   */
  apiDistDir: string;
  conn: ProjectDbConnection;
  /**
   * Bypass Node's ESM module cache when importing report files — used
   * by dev watchers to pick up changes without restarting.
   */
  bustCache?: boolean;
}

export interface SapportaProject {
  /** Human-readable project name shown in the frontend chrome and auth pages. */
  name: string;
  /** Project slug used for framework metadata and OpenAPI title generation. */
  slug: string;
  /** Compiled API directory used by metadata handlers to serve live schema info. */
  apiDistDir: string;
  /** Static table catalog loaded from project schema files. */
  catalog: TableCatalog;
  /** Loaded report definitions mounted by the framework report API. */
  reports: ReportDefinition[];
}

type FrameworkDocCtx = {
  tables: readonly TableDef[];
  reports: readonly ReportDefinition[];
};

export type SapportaFrameworkApi = TsRestApi<SapportaEnv, FrameworkDocCtx>;

export interface MountSapportaFrameworkOptions {
  conn: ProjectDbConnection;
  auth: {
    requireFrameworkAccess: SapportaAuthGuard;
  };
}

/**
 * Loads the Sapporta project catalog without mutating the Hono app.
 *
 * This imports compiled schema/report modules, builds the static table catalog,
 * and verifies the database migrations are ready for the loaded tables. Auth
 * boot should run after this so `SapportaAuthContext.rowSecurity` can bind to
 * the returned table definitions.
 */
export async function loadSapportaProject(
  opts: LoadSapportaProjectOptions,
): Promise<SapportaProject> {
  const { slug, apiDistDir, conn, bustCache } = opts;
  const { sqlite } = conn;
  const dirs = fromApiCodeDir(apiDistDir);

  const { tables } = await loadSchemas(dirs.schemaDir);
  const catalog = createTableCatalog(tables);

  assertMigrationsReady({
    projectRoot: opts.projectRoot,
    apiDistDir,
    sqlite,
    tables: catalog.tables,
  });

  const reports = await loadReports(dirs.reportsDir, bustCache);

  return {
    name: opts.name,
    slug,
    apiDistDir,
    catalog,
    reports,
  };
}

/**
 * Installs request-local database handles for all `/api/*` routes.
 *
 * Register this before project auth middleware and before any framework or user
 * routes that read `c.get("db")` or `c.get("sqlite")`.
 */
export function installSapportaRequestContext(
  app: Hono<SapportaEnv>,
  conn: ProjectDbConnection,
): void {
  const { sqlite, db } = conn;
  app.use("/api/*", async (c, next) => {
    c.set("db", db);
    c.set("sqlite", sqlite);
    return next();
  });
}

/**
 * Mounts Sapporta's framework API under `/api`.
 *
 * This installs the route policy first when auth is supplied, then mounts meta,
 * table, and report routes. It returns the framework `TsRestApi` so
 * `mountOpenApi()` can merge user route emitters into the same document.
 */
export function mountSapportaFramework(
  app: Hono<SapportaEnv>,
  project: SapportaProject,
  options: MountSapportaFrameworkOptions,
): SapportaFrameworkApi {
  const { conn } = options;
  const { sqlite, db } = conn;
  const { name, slug, apiDistDir, catalog, reports } = project;

  installFrameworkRoutePolicy(app, options.auth.requireFrameworkAccess);

  // Contract paths already carry the /meta, /tables, /reports prefix, so
  // mounting at /api yields the full URLs.
  const api = new TsRestApi<SapportaEnv, FrameworkDocCtx>();
  mountMeta(
    api,
    makeMetaHandlers(catalog, sqlite, { dir: apiDistDir, name, slug }),
  );
  mountTables(
    api,
    catalog,
    makeWorkspaceSafeTableHandlers(catalog, db, {
      guard: options.auth.requireFrameworkAccess,
    }),
  );
  mountReports(api, reports, makeReportHandlers(reports, sqlite));
  app.route("/api", api);

  return api;
}

/**
 * Publish `/api/openapi.json`, merging the framework spec with any
 * user-owned `TsRestApi` instances.
 *
 * Order-dependent: call after every route is registered. `extend()`
 * snapshots emitters at call time, so routes added to a `userApis` entry
 * later will be missing from the served spec.
 *
 * `userApis` is structurally typed (`{ docEmitters }`) so cross-bundle
 * `TsRestApi` instances — test fixtures, dev-mode reloads loaded from a
 * separate module instance — work without `instanceof` checks.
 */
export function mountOpenApi(
  app: Hono<SapportaEnv>,
  project: SapportaProject,
  frameworkApi: SapportaFrameworkApi,
  ...userApis: ReadonlyArray<{ docEmitters: ReadonlyArray<unknown> }>
): void {
  for (const userApi of userApis) {
    frameworkApi.extend(
      userApi as unknown as { docEmitters: readonly never[] },
    );
  }
  app.get("/api/openapi.json", (c) =>
    c.json(
      frameworkApi.generateDocument(
        { tables: project.catalog.tables, reports: project.reports },
        { info: { title: `${project.slug} API`, version: "1" } },
        { setOperationId: true, jsonQuery: true, pathPrefix: "/api" },
      ),
    ),
  );
}
