/**
 * Handler factory for the /meta namespace.
 *
 * Read-only introspection plus a SQL escape hatch.
 */

import type Database from "better-sqlite3";
import type { Context, Env } from "hono";
import type { TableCatalog } from "../schema/catalog.js";
import { extractSchemas, extractSchema } from "../schema/extract.js";
import { dbRun } from "../introspect/run.js";
import { dbIndexes } from "../introspect/indexes.js";
import { dbSample } from "../introspect/sample.js";
import { dbDescribeAll } from "../introspect/describe-all.js";
import {
  ErrorCode,
  OperationError,
  type OperationResult,
} from "../introspect/types.js";
import { parseOptionalBoundedInteger } from "../validation/bounded-integer.js";
import {
  apiErrorResponse,
  operationErrorResponse,
  operationResultResponse,
} from "./error-response.js";
import type { MetaHandlers } from "./mount-meta.js";

function resultToResponse(c: Context, result: OperationResult): Response {
  return operationResultResponse(c, result);
}

function withOperationError(c: Context, fn: () => OperationResult): Response {
  try {
    return resultToResponse(c, fn());
  } catch (err) {
    if (err instanceof OperationError) {
      return operationErrorResponse(c, err);
    }
    throw err;
  }
}

export function makeMetaHandlers<E extends Env>(
  catalog: TableCatalog,
  sqlite: Database.Database,
  project: { dir: string; name: string; slug: string },
): MetaHandlers<E> {
  return {
    // ── Project identity ─────────────────────────────────────────────
    projectInfo: ({ c }) => c.json({ name: project.name, slug: project.slug }),

    // ── Introspection ────────────────────────────────────────────────
    listTables: ({ c, request }) => {
      if (request.query?.detail === "full") {
        return withOperationError(c, () => dbDescribeAll(sqlite));
      }
      const data = extractSchemas(catalog.tables);
      for (const table of data) {
        try {
          const row = sqlite
            .prepare(`SELECT COUNT(*) AS cnt FROM "${table.name}"`)
            .get() as { cnt: number } | undefined;
          table.rowCount = row?.cnt ?? 0;
        } catch {
          throw new OperationError(
            `Registered table "${table.name}" is missing from the database. Run migrations before using this app.`,
            ErrorCode.INTERNAL,
          );
        }
      }
      return c.json({ tables: data });
    },

    getTable: ({ c, request }) => {
      const schema = extractSchema(catalog.tables, request.params.name);
      if (!schema)
        return apiErrorResponse(c, {
          error: `Table "${request.params.name}" not found`,
          code: ErrorCode.TABLE_NOT_FOUND,
        });
      return c.json(schema);
    },

    tableIndexes: ({ c, request }) =>
      withOperationError(c, () => dbIndexes(sqlite, request.params.name)),

    tableSample: ({ c, request }) => {
      const limit = parseSampleLimit(request.query?.limit);
      const fields = parseSampleFields(request.query?.fields);
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
          params: request.body.params,
        }),
      ),
  };
}

function parseSampleLimit(raw: string | undefined): number | undefined {
  return parseOptionalBoundedInteger(raw, {
    name: "limit",
    min: 1,
    max: 1000,
    makeError: (message) => new OperationError(message, ErrorCode.BAD_LIMIT),
  });
}

function parseSampleFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = raw
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  return fields.length > 0 ? fields : undefined;
}
