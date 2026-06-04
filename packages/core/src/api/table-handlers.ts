/**
 * Handler factory for the /tables namespace.
 *
 * Generated table routes are thin HTTP adapters over `scopedRows()`. The
 * request guard resolves the principal, `scopedRows()` binds that principal to
 * one table, and handlers stay focused on request extraction, status codes,
 * response envelopes, and CSV formatting.
 */

import type { Env } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Context } from "hono";
import { stream } from "hono/streaming";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableCatalog } from "../schema/catalog.js";
import { savePipeline } from "../data/save-pipeline.js";
import {
  ImmutableTableOperationError,
  RowNotFoundError,
  scopedRows,
} from "../data/scoped-rows.js";
import { cellToString, csvEscape } from "../data/csv.js";
import { findPkColumn } from "../schema/pk.js";
import { QueryParseError, ValidationError } from "../db/errors.js";
import { logger } from "../db/logger.js";
import type { TableHandlers } from "./mount-tables.js";
import type { SapportaEnv } from "./server.js";
import {
  AuthPayloadPolicyError,
  type SapportaAuthContext,
} from "../auth/index.js";
import type { TableDef } from "../schema/table.js";

const log = logger.child({ module: "table-handlers" });

function tableNotFoundResponse(tableName: string): Response {
  return Response.json(
    { error: `Table "${tableName}" not found`, code: "TABLE_NOT_FOUND" },
    { status: 404 },
  );
}

export interface WorkspaceSafeTableHandlersOptions<E extends SapportaEnv> {
  /**
   * Project-owned guard for framework routes. Generated projects usually pass
   * `projectAuth.requireWorkspaceOwner`.
   */
  guard: (c: Context<E>) => SapportaAuthContext;
}

export function makeWorkspaceSafeTableHandlers<E extends SapportaEnv>(
  catalog: TableCatalog,
  db: BetterSQLite3Database,
  options: WorkspaceSafeTableHandlersOptions<E>,
): TableHandlers<E> {
  const guard = options.guard;

  return {
    list:
      ({ def }) =>
      async ({ c }) => {
        const rows = scopedRows(db, guard(c), def);
        try {
          return c.json(await rows.list(queryParams(c)), 200);
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    get:
      ({ def }) =>
      async ({ c, request }) => {
        const rows = scopedRows(db, guard(c), def);
        try {
          return c.json({ data: await rows.get(request.params.id) }, 200);
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    create:
      ({ def }) =>
      async ({ c }) => {
        const auth = guard(c);
        const body = await c.req.json();
        try {
          if (isRecord(body) && isMasterDetailBody(body)) {
            return await handleMasterDetailCreate(
              def,
              db,
              c,
              catalog,
              auth,
              body,
            );
          }
          const rows = scopedRows(db, auth, def);
          return c.json({ data: await rows.create(body) }, 201);
        } catch (err) {
          return tableWriteErrorResponse(c, def, err);
        }
      },
    update:
      ({ def }) =>
      async ({ c, request }) => {
        const rows = scopedRows(db, guard(c), def);
        const body = await c.req.json();
        try {
          return c.json(
            { data: await rows.update(request.params.id, body) },
            200,
          );
        } catch (err) {
          return tableWriteErrorResponse(c, def, err);
        }
      },
    delete:
      ({ def }) =>
      async ({ c, request }) => {
        const rows = scopedRows(db, guard(c), def);
        try {
          return c.json({ data: await rows.delete(request.params.id) }, 200);
        } catch (err) {
          return tableWriteErrorResponse(c, def, err);
        }
      },
    exportCsv:
      ({ def }) =>
      async ({ c }) => {
        const rows = scopedRows(db, guard(c), def);
        try {
          return await streamCsv(c, def, await rows.exportRows(queryParams(c)));
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    lookup: ({ c, request }) => {
      const tableName = request.params.tableName;
      const def = catalog.get(tableName);
      if (!def) return tableNotFoundResponse(tableName);
      const rows = scopedRows(db, guard(c), def);
      return handleLookup(c, rows);
    },
    count: ({ c, request }) => {
      const tableName = request.params.tableName;
      const def = catalog.get(tableName);
      if (!def) return tableNotFoundResponse(tableName);
      const rows = scopedRows(db, guard(c), def);
      return handleCount(c, rows);
    },
  };
}

async function handleLookup<E extends Env>(
  c: Context<E>,
  rows: ReturnType<typeof scopedRows>,
): Promise<Response> {
  try {
    return c.json({ data: await rows.lookup(queryParams(c)) }, 200);
  } catch (err) {
    return tableReadErrorResponse(c, err);
  }
}

async function handleCount<E extends Env>(
  c: Context<E>,
  rows: ReturnType<typeof scopedRows>,
): Promise<Response> {
  try {
    return c.json({ data: await rows.count(queryParams(c)) }, 200);
  } catch (err) {
    return tableReadErrorResponse(c, err);
  }
}

async function handleMasterDetailCreate<E extends Env>(
  masterSchema: TableDef,
  db: BetterSQLite3Database,
  c: Context<E>,
  catalog: TableCatalog,
  auth: SapportaAuthContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const { $details, ...masterData } = body;
  if (!isDetailsSpec($details)) {
    return c.json(
      {
        error: "$details must have: table (string), fk (string), rows (array)",
      },
      400,
    );
  }

  const detailDef = catalog.get($details.table);
  if (!detailDef) {
    return c.json({ error: `Detail table "${$details.table}" not found` }, 404);
  }

  const masterAccess = auth.rowSecurity.forTable(masterSchema);
  const detailAccess = auth.rowSecurity.forTable(detailDef);
  const masterPrepared = await masterAccess.insertValues(db, masterData);
  const masterPkCol = findPkColumn(masterSchema);

  const result = await db.transaction(async (tx) => {
    const masterResult = (await savePipeline(
      masterSchema,
      tx,
      masterPrepared,
    )) as Record<string, unknown>;
    const masterPkValue = masterResult[masterPkCol.name];
    const detailResults: Record<string, unknown>[] = [];

    for (const row of $details.rows) {
      const prepared = await detailAccess.insertValues(tx, row, {
        serverValues: { [$details.fk]: masterPkValue },
      });
      detailResults.push(
        (await savePipeline(detailDef, tx, prepared)) as Record<string, unknown>,
      );
    }

    return { master: masterResult, details: detailResults };
  });

  return c.json({ data: result }, 201);
}

function tableReadErrorResponse<E extends Env>(
  c: Context<E>,
  err: unknown,
): Response {
  if (err instanceof RowNotFoundError) {
    return c.json({ error: "Not found" }, 404);
  }
  if (err instanceof QueryParseError) {
    return c.json(
      {
        error: err.message,
        code: err.code,
      },
      400,
    );
  }
  throw err;
}

function tableWriteErrorResponse<E extends Env>(
  c: Context<E>,
  table: TableDef,
  err: unknown,
): Response {
  if (err instanceof ImmutableTableOperationError) {
    return c.json({ error: "Records in this table are immutable" }, 403);
  }
  if (err instanceof RowNotFoundError) {
    return c.json({ error: "Not found" }, 404);
  }
  if (err instanceof AuthPayloadPolicyError) {
    log.warn("Auth payload policy failed", {
      table: table.sqlName,
      errors: err.errors,
    });
    return c.json(
      {
        error: "Validation failed",
        code: "validation_failed",
        details: err.errors,
      },
      422,
    );
  }
  if (err instanceof ValidationError) {
    log.warn("Write validation failed", {
      table: table.sqlName,
      errors: err.errors,
    });
    return c.json({ error: "Validation failed", details: err.errors }, 422);
  }
  if (err instanceof Error && err.message.includes("not found")) {
    return c.json({ error: "Not found" }, 404);
  }
  throw err;
}

async function streamCsv<E extends Env>(
  c: Context<E>,
  table: TableDef,
  rows: readonly Record<string, unknown>[],
): Promise<Response> {
  const columns = getTableConfig(table.drizzle).columns;
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${table.sqlName}.csv"`,
  );

  return stream(c, async (s) => {
    await s.write(columns.map((col) => csvEscape(col.name)).join(",") + "\n");
    for (const row of rows) {
      await s.write(
        columns
          .map((col) => csvEscape(cellToString(row[col.name])))
          .join(",") + "\n",
      );
    }
  });
}

function queryParams<E extends Env>(c: Context<E>): Record<string, string> {
  return Object.fromEntries(new URL(c.req.url).searchParams.entries());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMasterDetailBody(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "$details");
}

interface DetailsSpec {
  table: string;
  fk: string;
  rows: Record<string, unknown>[];
}

function isDetailsSpec(value: unknown): value is DetailsSpec {
  if (!isRecord(value)) return false;
  return (
    typeof value.table === "string" &&
    typeof value.fk === "string" &&
    Array.isArray(value.rows) &&
    value.rows.every(isRecord)
  );
}
