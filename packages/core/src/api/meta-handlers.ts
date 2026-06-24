/**
 * Handler factory for the /meta namespace.
 *
 * Read-only introspection plus a SQL escape hatch.
 */

import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Context } from "hono";
import type { TableCatalog } from "../schema/catalog.js";
import { extractSchemas, extractSchema } from "../schema/extract.js";
import { dbRun } from "../introspect/run.js";
import { dbIndexes } from "../introspect/indexes.js";
import { dbDescribeAll } from "../introspect/describe-all.js";
import {
  ErrorCode,
  OperationError,
  type OperationResult,
} from "../introspect/types.js";
import { parseOptionalBoundedInteger } from "@sapporta/shared/validation";
import { columnPropertyName } from "../auth/row-scope.js";
import { RowScopePolicyError, type SapportaAuthContext } from "../auth/index.js";
import { QueryParseError } from "../db/errors.js";
import { scopedRows } from "../data/scoped-rows.js";
import type { SapportaAuthGuard, SapportaEnv } from "./server.js";
import type { TableDef } from "../schema/table.js";
import {
  apiErrorResponse,
  operationErrorResponse,
  operationResultResponse,
} from "./error-response.js";
import type { MetaHandlers } from "./mount-meta.js";
import { forbidUnless } from "../auth/forbid.js";

const UNRESTRICTED_META_SUBJECT = "sapporta_unrestricted_access";

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

export interface AuthorizedMetaHandlersOptions<E extends SapportaEnv> {
  /** Project-owned auth guard that returns the request auth context. */
  requireAuthContext: SapportaAuthGuard<E>;
}

export function makeMetaHandlers<E extends SapportaEnv>(
  catalog: TableCatalog,
  sqlite: Database.Database,
  db: BetterSQLite3Database,
  project: { dir: string; name: string; slug: string },
  options: AuthorizedMetaHandlersOptions<E>,
): MetaHandlers<E> {
  const requireAuthContext = options.requireAuthContext;

  return {
    // ── Project identity ─────────────────────────────────────────────
    projectInfo: ({ c }) => c.json({ name: project.name, slug: project.slug }),

    // ── Introspection ────────────────────────────────────────────────
    listTables: ({ c, request }) => {
      const auth = requireAuthContext(c);
      if (request.query?.detail === "full") {
        requireUnrestrictedMetaAccess(c, auth);
        return withOperationError(c, () => dbDescribeAll(sqlite));
      }
      const data = extractSchemas(catalog.tables);
      if (hasUnrestrictedMetaAccess(auth)) {
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
      }
      return c.json({ tables: data });
    },

    getTable: ({ c, request }) => {
      requireAuthContext(c);
      const schema = extractSchema(catalog.tables, request.params.name);
      if (!schema)
        return apiErrorResponse(c, {
          error: `Table "${request.params.name}" not found`,
          code: ErrorCode.TABLE_NOT_FOUND,
        });
      return c.json(schema);
    },

    tableIndexes: ({ c, request }) => {
      requireUnrestrictedMetaAccess(c, requireAuthContext(c));
      return withOperationError(c, () =>
        dbIndexes(sqlite, request.params.name),
      );
    },

    tableSample: async ({ c, request }) => {
      try {
        const def = catalog.get(request.params.name);
        if (!def) return tableNotFoundResponse(c, request.params.name);

        const auth = requireAuthContext(c);
        forbidUnless(c, auth.ability.can("read", def.sqlName));

        const limit = parseSampleLimit(request.query?.limit) ?? 5;
        const fields = parseSampleFields(request.query?.fields);
        const projection = resolveSampleProjection(def, fields);
        const result = await scopedRows(db, auth, def).list({
          limit: String(limit),
        });

        return c.json(projectSampleRows(result.data, projection));
      } catch (err) {
        if (err instanceof OperationError) {
          return operationErrorResponse(c, err);
        }
        if (err instanceof QueryParseError) {
          return apiErrorResponse(c, {
            error: err.message,
            code: err.code,
            status: 400,
          });
        }
        if (err instanceof RowScopePolicyError) {
          return apiErrorResponse(c, {
            error: "Forbidden",
            code: err.code,
            status: 403,
          });
        }
        throw err;
      }
    },

    // ── SQL proxy ────────────────────────────────────────────────────
    sql: ({ c, request }) => {
      const auth = requireAuthContext(c);
      requireUnrestrictedMetaAccess(c, auth);
      return withOperationError(c, () =>
        dbRun(sqlite, request.body.sql, {
          limit: request.body.limit,
          dryRun: request.body.dryRun,
          allowDangerous: request.body.allowDangerous,
          params: request.body.params,
        }),
      );
    },
  };
}

function hasUnrestrictedMetaAccess(auth: SapportaAuthContext): boolean {
  return auth.ability.can("manage", UNRESTRICTED_META_SUBJECT);
}

function requireUnrestrictedMetaAccess<E extends SapportaEnv>(
  c: Context<E>,
  auth: SapportaAuthContext,
): void {
  forbidUnless(c, hasUnrestrictedMetaAccess(auth));
}

function tableNotFoundResponse<E extends SapportaEnv>(
  c: Context<E>,
  tableName: string,
): Response {
  return apiErrorResponse(c, {
    error: `Table "${tableName}" not found`,
    code: ErrorCode.TABLE_NOT_FOUND,
  });
}

function parseSampleLimit(raw: string | undefined): number | undefined {
  return parseOptionalBoundedInteger(raw, {
    name: "limit",
    min: 1,
    max: 1000,
    makeError: (message) => new OperationError(message, ErrorCode.BAD_LIMIT),
  });
}

interface SampleFieldProjection {
  responseName: string;
  rowName: string;
}

function resolveSampleProjection(
  table: TableDef,
  fields: readonly string[] | undefined,
): SampleFieldProjection[] {
  const columnsByName = new Map<string, SQLiteColumn>();
  for (const column of getTableConfig(table.drizzle).columns) {
    columnsByName.set(column.name, column);
  }

  const requestedFields =
    fields ?? getTableConfig(table.drizzle).columns.map((column) => column.name);
  const projection: SampleFieldProjection[] = [];
  const unknownFields: string[] = [];
  for (const field of requestedFields) {
    const column = columnsByName.get(field);
    if (!column) {
      unknownFields.push(field);
      continue;
    }
    projection.push({
      responseName: field,
      rowName: columnPropertyName(table, column) ?? field,
    });
  }

  if (unknownFields.length > 0) {
    throw new OperationError(
      `Unknown column(s) in '${table.sqlName}': ${unknownFields.join(", ")}`,
      ErrorCode.INVALID_COLUMN_NAME,
    );
  }

  return projection;
}

function projectSampleRows(
  rows: readonly Record<string, unknown>[],
  projection: readonly SampleFieldProjection[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const field of projection) {
      projected[field.responseName] = row[field.rowName];
    }
    return projected;
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
