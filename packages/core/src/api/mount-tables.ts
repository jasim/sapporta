/**
 * Mount the tables namespace via `registerFamily` — one generic Hono
 * route per operation that dispatches to the per-table concrete route.
 *
 * Mount order matters: specific paths (`_lookup`, `_count`, `export.csv`,
 * `:id`) MUST register before the bare `/tables/:tableName` — Hono
 * matches in registration order, and a parametric route would swallow
 * the specific ones if it went first.
 */

import type { Context, Env } from "hono";
import type { AppRoute } from "@sapporta/rest-core";
import type { TableDef } from "../schema/table.js";
import type {
  HttpMethod,
  RouteHandler,
  TsRestApi,
} from "@sapporta/honest";
import { countRoute, lookupRoute } from "@sapporta/shared/contracts";
import {
  createRoute,
  deleteRoute,
  exportCsvRoute,
  getRoute,
  listRoute,
  updateRoute,
} from "./table-contracts.js";

export interface TableResolver {
  get(name: string): TableDef | undefined;
}

export interface TablesDocContext {
  tables: readonly TableDef[];
}

export type TableFamilyHandler<R extends AppRoute, E extends Env> = (args: {
  def: TableDef;
  route: R;
  tables: readonly TableDef[];
}) => RouteHandler<R, E>;

export interface TableHandlers<E extends Env> {
  list: TableFamilyHandler<ReturnType<typeof listRoute>, E>;
  get: TableFamilyHandler<ReturnType<typeof getRoute>, E>;
  create: TableFamilyHandler<ReturnType<typeof createRoute>, E>;
  update: TableFamilyHandler<ReturnType<typeof updateRoute>, E>;
  delete: TableFamilyHandler<ReturnType<typeof deleteRoute>, E>;
  exportCsv: TableFamilyHandler<ReturnType<typeof exportCsvRoute>, E>;
  lookup: RouteHandler<typeof lookupRoute, E>;
  count: RouteHandler<typeof countRoute, E>;
}

function tableNotFound<E extends Env>(c: Context<E>): Response {
  const tableName = c.req.param("tableName");
  return c.json(
    {
      error: tableName
        ? `Table "${tableName}" not found`
        : "Table name required",
      code: "TABLE_NOT_FOUND",
    },
    404,
  );
}

function asGenericHandler<R extends AppRoute, E extends Env>(
  h: RouteHandler<R, E>,
): RouteHandler<AppRoute, E> {
  return h as unknown as RouteHandler<AppRoute, E>;
}

/**
 * Register one `/tables/:tableName/...` family on `api`: fans out into
 * per-table OpenAPI entries keyed `${opName}_${sqlName}` and dispatches
 * at request time by looking the concrete table up in the resolver.
 */
function registerTableFamily<
  R extends AppRoute,
  E extends Env,
  DocCtx extends TablesDocContext,
>(
  api: TsRestApi<E, DocCtx>,
  resolver: TableResolver,
  tables: () => readonly TableDef[],
  opts: {
    opName: string;
    method: HttpMethod;
    genericPath: string;
    routeFor: (def: TableDef, all: readonly TableDef[]) => R;
    handler: TableFamilyHandler<R, E>;
  },
): void {
  api.registerFamily({
    method: opts.method,
    genericPath: opts.genericPath,
    docs: (ctx) =>
      Object.fromEntries(
        ctx.tables.map((d) => [
          `${opts.opName}_${d.sqlName}`,
          opts.routeFor(d, ctx.tables),
        ]),
      ),
    dispatch: (c) => {
      const def = resolver.get(c.req.param("tableName") ?? "");
      if (!def) return undefined;
      const all = tables();
      const route = opts.routeFor(def, all);
      return {
        route,
        handler: asGenericHandler(opts.handler({ def, route, tables: all })),
      };
    },
    notFound: tableNotFound<E>,
  });
}

export function mountTables<
  E extends Env,
  DocCtx extends TablesDocContext = TablesDocContext,
>(
  api: TsRestApi<E, DocCtx>,
  resolver: TableResolver,
  handlers: TableHandlers<E>,
  tables: () => readonly TableDef[],
): TsRestApi<E, DocCtx> {
  // Lookup and count are NOT family-specialized — their response schema is
  // passthrough regardless of table. One contract each, registered as a
  // static route whose path happens to have a `:tableName` param.
  api.register("tablesLookup", lookupRoute, handlers.lookup);
  api.register("tablesCount", countRoute, handlers.count);

  // Individual calls (not a loop) because each family's AppRoute type is
  // distinct — the discriminated union collapses to `AppRoute` in an array
  // and TypeScript can no longer match the handler's route-specific
  // `request` type.
  registerTableFamily(api, resolver, tables, {
    opName: "exportCsv",
    method: "get",
    genericPath: "/tables/:tableName/export.csv",
    routeFor: (d) => exportCsvRoute(d),
    handler: handlers.exportCsv,
  });
  registerTableFamily(api, resolver, tables, {
    opName: "get",
    method: "get",
    genericPath: "/tables/:tableName/:id",
    routeFor: (d) => getRoute(d),
    handler: handlers.get,
  });
  registerTableFamily(api, resolver, tables, {
    opName: "list",
    method: "get",
    genericPath: "/tables/:tableName",
    routeFor: (d) => listRoute(d),
    handler: handlers.list,
  });
  registerTableFamily(api, resolver, tables, {
    opName: "create",
    method: "post",
    genericPath: "/tables/:tableName",
    routeFor: (d, all) => createRoute(d, all),
    handler: handlers.create,
  });
  registerTableFamily(api, resolver, tables, {
    opName: "update",
    method: "put",
    genericPath: "/tables/:tableName/:id",
    routeFor: (d) => updateRoute(d),
    handler: handlers.update,
  });
  registerTableFamily(api, resolver, tables, {
    opName: "delete",
    method: "delete",
    genericPath: "/tables/:tableName/:id",
    routeFor: (d) => deleteRoute(d),
    handler: handlers.delete,
  });

  return api;
}
