/**
 * Framework boot for projects that own their entry point.
 *
 * Two-step API:
 *   1. `loadSapporta(app, opts)` — middleware, schemas, migrations, and
 *      the framework REST API (/api/meta, /api/tables, /api/reports).
 *   2. `mountOpenApi(app, framework, ...userApis)` — publishes
 *      /api/openapi.json. Must run after every route is registered.
 *
 * The split exists because OpenAPI emission snapshots route emitters at
 * call time, so it has to come last; framework boot itself is order-
 * agnostic relative to user routes.
 *
 * To customize the framework slice (different migration strategy,
 * non-standard mount paths), inline `loadSapporta()` — every step it
 * runs is a public export of @sapporta/server.
 */

import type { Hono } from "hono";
import { installSapportaDefaults, type SapportaEnv } from "./api/server.js";
import type { ProjectDbConnection } from "./db/sqlite-connection.js";
import type { ReportDefinition } from "./reports/report.js";
import type { TableDef } from "./schema/table.js";
import { fromApiCodeDir } from "./project-paths.js";
import { SchemaRegistry } from "./schema/registry.js";
import { loadSchemas } from "./schema/loader.js";
import { migrateSchemas } from "./schema/migrate.js";
import { loadReports } from "./reports/loader.js";
import {
  TsRestApi,
  mountMeta,
  mountTables,
  mountReports,
  makeMetaHandlers,
  makeTableHandlers,
  makeReportHandlers,
} from "./api/index.js";

export interface LoadSapportaOptions {
  slug: string;
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

export interface LoadSapportaResult {
  slug: string;
  registry: SchemaRegistry;
  reports: ReportDefinition[];
  /**
   * Framework `TsRestApi` mounted at `/api`. Pass back to
   * `mountOpenApi()` to publish a merged spec.
   */
  api: TsRestApi<SapportaEnv, FrameworkDocCtx>;
}

type FrameworkDocCtx = {
  tables: readonly TableDef[];
  reports: readonly ReportDefinition[];
};

export async function loadSapporta(
  app: Hono<SapportaEnv>,
  opts: LoadSapportaOptions,
): Promise<LoadSapportaResult> {
  const { slug, apiDistDir, conn, bustCache } = opts;
  const { sqlite, db } = conn;
  const dirs = fromApiCodeDir(apiDistDir);

  installSapportaDefaults(app);

  const registry = new SchemaRegistry();
  const { tables } = await loadSchemas(dirs.schemaDir);
  for (const def of tables) registry.register(def);

  await migrateSchemas(registry.all(), db, sqlite);

  const reports = await loadReports(dirs.reportsDir, bustCache);

  // Register context middleware BEFORE mounting sub-apps so every /api/*
  // request — framework or user — sees `c.get("db")` populated.
  app.use("/api/*", async (c, next) => {
    c.set("db", db);
    c.set("sqlite", sqlite);
    return next();
  });

  // Contract paths already carry the /meta, /tables, /reports prefix, so
  // mounting at /api yields the full URLs.
  const api = new TsRestApi<SapportaEnv, FrameworkDocCtx>();
  mountMeta(
    api,
    makeMetaHandlers(registry, sqlite, db, { dir: apiDistDir, slug }),
  );
  const tableResolver = {
    get: (name: string) => registry.get(name)?.def,
  };
  mountTables(api, tableResolver, makeTableHandlers(registry, db), () =>
    registry.all(),
  );
  mountReports(api, reports, makeReportHandlers(reports, sqlite));
  app.route("/api", api);

  return { slug, registry, reports, api };
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
  framework: LoadSapportaResult,
  ...userApis: ReadonlyArray<{ docEmitters: ReadonlyArray<unknown> }>
): void {
  for (const userApi of userApis) {
    framework.api.extend(
      userApi as unknown as { docEmitters: readonly never[] },
    );
  }
  app.get("/api/openapi.json", (c) =>
    c.json(
      framework.api.generateDocument(
        { tables: framework.registry.all(), reports: framework.reports },
        { info: { title: `${framework.slug} API`, version: "1" } },
        { setOperationId: true, jsonQuery: true, pathPrefix: "/api" },
      ),
    ),
  );
}
