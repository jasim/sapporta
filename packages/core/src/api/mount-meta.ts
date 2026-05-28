/**
 * Register the static meta routes on a `TsRestApi`.
 *
 * Parallel to `mount-tables.ts` but uses `api.register(...)` directly
 * since the meta set is fixed at boot — no per-request dispatch needed.
 *
 * Handlers are passed in (not built here) so the runtime deps they need
 * — the Drizzle db, the raw sqlite handle, the SchemaRegistry — stay in
 * the caller's scope instead of leaking into the contract layer.
 */

import type { Env } from "hono";
import type { RouteHandler, TsRestApi } from "@sapporta/honest";
import {
  getTableRoute,
  listTablesRoute,
  projectInfoRoute,
  sqlRoute,
  tableIndexesRoute,
  tableSampleRoute,
} from "@sapporta/shared/contracts";

export interface MetaHandlers<E extends Env> {
  projectInfo: RouteHandler<typeof projectInfoRoute, E>;
  listTables: RouteHandler<typeof listTablesRoute, E>;
  getTable: RouteHandler<typeof getTableRoute, E>;
  tableIndexes: RouteHandler<typeof tableIndexesRoute, E>;
  tableSample: RouteHandler<typeof tableSampleRoute, E>;
  sql: RouteHandler<typeof sqlRoute, E>;
}

export function mountMeta<E extends Env, DocCtx>(
  api: TsRestApi<E, DocCtx>,
  handlers: MetaHandlers<E>,
): TsRestApi<E, DocCtx> {
  // Specific paths first so Hono doesn't match a parametric route before
  // the concrete one (e.g. `/meta/tables/:name/indexes` before
  // `/meta/tables/:name`).
  api.register("metaProjectInfo", projectInfoRoute, handlers.projectInfo);

  api.register("metaTableIndexes", tableIndexesRoute, handlers.tableIndexes);
  api.register("metaTableSample", tableSampleRoute, handlers.tableSample);

  api.register("metaGetTable", getTableRoute, handlers.getTable);

  api.register("metaListTables", listTablesRoute, handlers.listTables);
  api.register("metaSql", sqlRoute, handlers.sql);

  return api;
}
