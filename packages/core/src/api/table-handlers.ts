/**
 * Handler factory for the /tables namespace.
 *
 * Thin adapter over the CRUD handlers in `data/crud.ts` plus lookup/count
 * helpers. Those return `Response` objects directly — the ts-rest-hono
 * adapter's `execute()` passes Response through unchanged, so we don't need
 * to restructure bodies into the `{status, body}` shape. That choice keeps
 * the battle-tested crud.ts logic in one place while the ts-rest layer owns
 * OpenAPI + request parsing.
 */

import type { Env } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SchemaRegistry } from "../schema/registry.js";
import {
  handleCreate,
  handleDelete,
  handleExportCsv,
  handleGet,
  handleList,
  handleUpdate,
} from "../data/crud.js";
import { handleLookup } from "../data/lookup.js";
import { handleCount } from "../data/count.js";
import { logger } from "../db/logger.js";
import type { TableHandlers } from "./mount-tables.js";

const log = logger.child({ module: "crud" });

/**
 * better-sqlite3 throws a plain `Error` whose message starts with
 * `no such table: <name>` when the underlying table has been dropped
 * out-of-band. There is no typed error to catch, so we pattern-match on
 * the message. Isolated here so callers express the intent
 * (`isNoSuchTableError(err)`) rather than re-implementing the string check.
 */
function isNoSuchTableError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("no such table");
}

function tableNotFoundResponse(tableName: string): Response {
  return Response.json(
    { error: `Table "${tableName}" not found`, code: "TABLE_NOT_FOUND" },
    { status: 404 },
  );
}

async function withStaleTableGuard(
  registry: SchemaRegistry,
  tableName: string,
  fn: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (isNoSuchTableError(err)) {
      log.warn("Table no longer exists", { table: tableName });
      registry.unregister(tableName);
      return Response.json(
        {
          error: `Table "${tableName}" no longer exists in the database`,
          code: "TABLE_GONE",
        },
        { status: 410 },
      );
    }
    throw err;
  }
}

export function makeTableHandlers<E extends Env>(
  registry: SchemaRegistry,
  db: BetterSQLite3Database,
): TableHandlers<E> {
  return {
    list: ({ def }) =>
      ({ c }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleList(def, db, c),
        ),
    get: ({ def }) =>
      ({ c, request }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleGet(def, db, c, request.params.id),
        ),
    create: ({ def }) =>
      ({ c }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleCreate(def, db, c, { registry }),
        ),
    update: ({ def }) =>
      ({ c, request }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleUpdate(def, db, c, request.params.id),
        ),
    delete: ({ def }) =>
      ({ c, request }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleDelete(def, db, c, request.params.id),
        ),
    exportCsv: ({ def }) =>
      ({ c }) =>
        withStaleTableGuard(registry, def.sqlName, () =>
          handleExportCsv(def, db, c),
        ),
    lookup: ({ c, request }) => {
      const tableName = request.params.tableName;
      const entry = registry.get(tableName);
      if (!entry) return tableNotFoundResponse(tableName);
      return withStaleTableGuard(registry, tableName, () =>
        handleLookup(entry.def, db, c),
      );
    },
    count: ({ c, request }) => {
      const tableName = request.params.tableName;
      const entry = registry.get(tableName);
      if (!entry) return tableNotFoundResponse(tableName);
      return withStaleTableGuard(registry, tableName, () =>
        handleCount(entry.def, db, c),
      );
    },
  };
}
