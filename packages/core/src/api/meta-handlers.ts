/**
 * Handler factory for the /meta namespace.
 *
 * Read-only introspection plus a SQL escape hatch and a schema-sync trigger
 * that reloads file schemas from disk and re-runs migrations.
 */

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Context, Env } from "hono";
import type { SchemaRegistry } from "../schema/registry.js";
import { extractSchemas, extractSchema } from "../schema/extract.js";
import { dbRun } from "../introspect/run.js";
import { dbIndexes } from "../introspect/indexes.js";
import { dbSample } from "../introspect/sample.js";
import { dbDescribeAll } from "../introspect/describe-all.js";
import { loadSchemas } from "../schema/loader.js";
import { migrateSchemas } from "../schema/migrate.js";
import { fromApiCodeDir } from "../project-paths.js";
import {
  OperationError,
  type OperationResult,
} from "../introspect/types.js";
import { ERROR_CODE_STATUS } from "./error-codes.js";
import type { MetaHandlers } from "./mount-meta.js";

type JsonObject = Record<string, unknown>;

function jsonError(
  c: Context,
  message: string,
  status: 400 | 404 | 409 | 422 | 500,
  extra?: JsonObject,
): Response {
  return c.json({ error: message, ...(extra ?? {}) }, status);
}

function resultToResponse(c: Context, result: OperationResult): Response {
  if (result.ok) return c.json(result.data);
  const status = (ERROR_CODE_STATUS[result.code] ?? 500) as 400 | 404 | 422 | 500;
  return c.json({ error: result.error }, status);
}

function withOperationError(
  c: Context,
  fn: () => OperationResult,
): Response {
  try {
    return resultToResponse(c, fn());
  } catch (err) {
    if (err instanceof OperationError) {
      const status = (ERROR_CODE_STATUS[err.code] ?? 500) as 400 | 404 | 422 | 500;
      return c.json({ error: err.message, code: err.code }, status);
    }
    throw err;
  }
}

export function makeMetaHandlers<E extends Env>(
  registry: SchemaRegistry,
  sqlite: Database.Database,
  db: BetterSQLite3Database,
  project: { dir: string; slug: string },
): MetaHandlers<E> {
  return {
    // ── Project identity ─────────────────────────────────────────────
    projectInfo: ({ c }) => c.json({ slug: project.slug }),

    // ── Introspection ────────────────────────────────────────────────
    listTables: ({ c, request }) => {
      if (request.query?.detail === "full") {
        return withOperationError(c, () => dbDescribeAll(sqlite));
      }
      const data = extractSchemas(registry);
      for (const table of data) {
        try {
          const row = sqlite
            .prepare(`SELECT COUNT(*) AS cnt FROM "${table.name}"`)
            .get() as { cnt: number } | undefined;
          table.rowCount = row?.cnt ?? 0;
        } catch {
          table.rowCount = 0;
        }
      }
      return c.json({ tables: data });
    },

    getTable: ({ c, request }) => {
      const schema = extractSchema(registry, request.params.name);
      if (!schema) return jsonError(c, `Table "${request.params.name}" not found`, 404);
      return c.json(schema);
    },

    tableIndexes: ({ c, request }) =>
      withOperationError(c, () => dbIndexes(sqlite, request.params.name)),

    tableSample: ({ c, request }) => {
      const limit = request.query?.limit ? parseInt(request.query.limit) : undefined;
      const fields = request.query?.fields?.split(",");
      return withOperationError(c, () =>
        dbSample(sqlite, request.params.name, limit, fields),
      );
    },

    // ── SQL proxy ────────────────────────────────────────────────────
    sql: ({ c, request }) =>
      withOperationError(c, () =>
        dbRun(sqlite, request.body.sql, {
          limit: request.body.limit,
          dryRun: request.body.dryRun,
        }),
      ),

    // ── Schema sync ──────────────────────────────────────────────────
    schemaSync: async ({ c }) => {
      const { schemaDir } = fromApiCodeDir(project.dir);
      const { tables } = await loadSchemas(schemaDir);
      for (const def of tables) {
        registry.register(def);
      }
      await migrateSchemas(registry.all(), db, sqlite);
      return c.json({ ok: true, tables: tables.length });
    },
  };
}
