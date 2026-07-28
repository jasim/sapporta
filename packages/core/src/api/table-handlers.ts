/**
 * Handler factory for the /tables namespace.
 *
 * Generated table routes are thin HTTP adapters over `scopedRows()`. The
 * request guard returns the current auth context, table handlers check CASL,
 * `scopedRows()` binds the request scope to one table, and handlers stay
 * focused on request extraction, status codes, response envelopes, and CSV
 * formatting.
 *
 * Generated table subjects are the table's canonical SQL name. A CASL rule such
 * as `can("read", "quotes")` allows the generic table action, and
 * `can("manage", "all")` can satisfy every generated action check. Neither
 * rule widens row visibility; `scopedRows()` still applies the request's row
 * predicates and trusted insert stamping.
 */

import type { Env } from "hono";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Context } from "hono";
import { stream } from "hono/streaming";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { CountResult } from "@sapporta/shared/contracts";
import type { TableCatalog } from "../schema/catalog.js";
import { savePipeline, savePipelineInsertSync } from "../data/save-pipeline.js";
import {
  ImmutableTableOperationError,
  RowNotFoundError,
  scopedRows,
} from "../data/scoped-rows.js";
import { cellToString, csvEscape } from "../data/csv.js";
import { findPkColumn } from "../schema/pk.js";
import {
  classifySqliteError,
  QueryParseError,
  ValidationError,
} from "../db/errors.js";
import { logger } from "../db/logger.js";
import { ErrorCode } from "../introspect/types.js";
import {
  apiErrorResponse,
  classifiedSqliteErrorResponse,
  jsonErrorResponse,
} from "./error-response.js";
import type { TableHandlers } from "./mount-tables.js";
import type { SapportaEnv } from "./server.js";
import {
  ApiWritePolicyError,
  forbidUnless,
  RowScopePolicyError,
  type SapportaAuthContext,
} from "../auth/index.js";
import type { TableDef } from "../schema/table.js";
import { resolveCountQuery } from "../data/count-query.js";

const log = logger.child({ module: "table-handlers" });

function tableNotFoundResponse(tableName: string): Response {
  return jsonErrorResponse({
    error: `Table "${tableName}" not found`,
    code: ErrorCode.TABLE_NOT_FOUND,
  });
}

type GeneratedTableAction = "read" | "export" | "create" | "update" | "delete";

export interface AuthorizedTableHandlersOptions<E extends SapportaEnv> {
  /** Project-owned guard that returns the current request auth context. */
  guard: (c: Context<E>) => SapportaAuthContext;
}

export function makeAuthorizedTableHandlers<E extends SapportaEnv>(
  catalog: TableCatalog,
  db: BetterSQLite3Database,
  options: AuthorizedTableHandlersOptions<E>,
): TableHandlers<E> {
  const guard = options.guard;

  return {
    list:
      ({ def }) =>
      async ({ c }) => {
        const auth = authorizeTableAction(c, guard(c), "read", def);
        const rows = scopedRows(db, auth, def);
        try {
          return c.json(
            await rows.list(queryParams(c), {
              searchPlan: catalog.searchPlanFor(def.sqlName),
            }),
            200,
          );
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    get:
      ({ def }) =>
      async ({ c, request }) => {
        const auth = authorizeTableAction(c, guard(c), "read", def);
        const rows = scopedRows(db, auth, def);
        try {
          return c.json({ data: await rows.get(request.params.id) }, 200);
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    create:
      ({ def }) =>
      async ({ c, request }) => {
        const auth = authorizeTableAction(c, guard(c), "create", def);
        // The adapter has already decoded the JSON into `request.body`. The
        // route's skip flag bypasses Zod validation, not body extraction, so the
        // handler must preserve this exact payload for auth and save parsing.
        const body: unknown = request.body;
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
        const auth = authorizeTableAction(c, guard(c), "update", def);
        const rows = scopedRows(db, auth, def);
        try {
          return c.json(
            { data: await rows.update(request.params.id, request.body) },
            200,
          );
        } catch (err) {
          return tableWriteErrorResponse(c, def, err);
        }
      },
    delete:
      ({ def }) =>
      async ({ c, request }) => {
        const auth = authorizeTableAction(c, guard(c), "delete", def);
        const rows = scopedRows(db, auth, def);
        try {
          return c.json({ data: await rows.delete(request.params.id) }, 200);
        } catch (err) {
          return tableWriteErrorResponse(c, def, err);
        }
      },
    exportCsv:
      ({ def }) =>
      async ({ c }) => {
        const auth = authorizeTableAction(c, guard(c), "export", def);
        const rows = scopedRows(db, auth, def);
        try {
          return await streamCsv(
            c,
            def,
            await rows.exportRows(queryParams(c), {
              searchPlan: catalog.searchPlanFor(def.sqlName),
            }),
          );
        } catch (err) {
          return tableReadErrorResponse(c, err);
        }
      },
    lookup: ({ c, request }) => {
      const tableName = request.params.tableName;
      const def = catalog.get(tableName);
      if (!def) return tableNotFoundResponse(tableName);
      const auth = authorizeTableAction(c, guard(c), "read", def);
      const rows = scopedRows(db, auth, def);
      return handleLookup(c, rows);
    },
    count: async ({ c, request }) => {
      const tableName = request.params.tableName;
      const def = catalog.get(tableName);
      if (!def) return tableNotFoundResponse(tableName);
      const auth = authorizeTableAction(c, guard(c), "read", def);
      const rows = scopedRows(db, auth, def);
      try {
        const count = resolveCountQuery(request.query, def);
        if (count.kind === "total") {
          const data: CountResult = {
            kind: "total",
            count: await rows.count(count.input),
          };
          return c.json({ data }, 200);
        }
        const data: CountResult = {
          kind: "grouped",
          groups: await rows.countBy(count.input),
        };
        return c.json({ data }, 200);
      } catch (err) {
        return tableReadErrorResponse(c, err);
      }
    },
  };
}

function authorizeTableAction<E extends SapportaEnv>(
  c: Context<E>,
  auth: SapportaAuthContext,
  action: GeneratedTableAction,
  table: TableDef,
): SapportaAuthContext {
  // Ask for the concrete generated action even when CASL may satisfy it via a
  // broader `manage` rule. Row security is enforced by the scoped row operation
  // that follows, not by CASL condition objects.
  forbidUnless(c, auth.ability.can(action, table.sqlName));
  return auth;
}

async function handleLookup<E extends Env>(
  c: Context<E>,
  rows: ReturnType<typeof scopedRows>,
): Promise<Response> {
  try {
    return c.json({ entries: await rows.lookup(queryParams(c)) }, 200);
  } catch (err) {
    return tableReadErrorResponse(c, err);
  }
}

async function handleMasterDetailCreate<E extends SapportaEnv>(
  masterSchema: TableDef,
  db: BetterSQLite3Database,
  c: Context<E>,
  catalog: TableCatalog,
  auth: SapportaAuthContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const { $details, ...masterData } = body;
  if (!isDetailsSpec($details)) {
    return apiErrorResponse(c, {
      error: "$details must have: table (string), fk (string), rows (array)",
      status: 400,
    });
  }

  const detailDef = catalog.get($details.table);
  if (!detailDef) {
    return apiErrorResponse(c, {
      error: `Detail table "${$details.table}" not found`,
      code: ErrorCode.TABLE_NOT_FOUND,
    });
  }
  // Parent and child rows are both creates, so both tables need an explicit
  // create grant. The shared auth context still stamps and validates each table
  // through its own row-scope metadata.
  authorizeTableAction(c, auth, "create", detailDef);

  const masterAccess = auth.rowSecurity.forTable(masterSchema);
  const detailAccess = auth.rowSecurity.forTable(detailDef);
  const masterPrepared = await masterAccess.insertValues(db, masterData);
  const masterPkCol = findPkColumn(masterSchema);

  const result = db.transaction((tx) => {
    const masterResult = savePipelineInsertSync(
      masterSchema,
      tx,
      masterPrepared,
    ) as Record<string, unknown>;
    const masterPkValue = masterResult[masterPkCol.name];
    const detailResults: Record<string, unknown>[] = [];

    for (const row of $details.rows) {
      const prepared = detailAccess.insertValuesSync(tx, row, {
        serverValues: { [$details.fk]: masterPkValue },
      });
      detailResults.push(
        savePipelineInsertSync(detailDef, tx, prepared) as Record<
          string,
          unknown
        >,
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
    return apiErrorResponse(c, {
      error: "Not found",
      code: ErrorCode.ROW_NOT_FOUND,
    });
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

function tableWriteErrorResponse<E extends Env>(
  c: Context<E>,
  table: TableDef,
  err: unknown,
): Response {
  if (err instanceof ImmutableTableOperationError) {
    return apiErrorResponse(c, {
      error: "Records in this table are immutable",
      code: ErrorCode.FORBIDDEN,
    });
  }
  if (err instanceof RowNotFoundError) {
    return apiErrorResponse(c, {
      error: "Not found",
      code: ErrorCode.ROW_NOT_FOUND,
    });
  }
  if (err instanceof RowScopePolicyError) {
    return apiErrorResponse(c, {
      error: "Forbidden",
      code: err.code,
      status: 403,
    });
  }
  if (err instanceof ApiWritePolicyError) {
    log.warn("API write policy failed", {
      table: table.sqlName,
      errors: err.errors,
    });
    return apiErrorResponse(c, {
      error: "Validation failed",
      code: ErrorCode.VALIDATION_FAILED,
      details: err.errors,
    });
  }
  if (err instanceof ValidationError) {
    log.warn("Write validation failed", {
      table: table.sqlName,
      errors: err.errors,
    });
    return apiErrorResponse(c, {
      error: "Validation failed",
      code: ErrorCode.VALIDATION_FAILED,
      details: err.errors,
    });
  }
  if (err instanceof Error && err.message.includes("not found")) {
    return apiErrorResponse(c, {
      error: "Not found",
      code: ErrorCode.ROW_NOT_FOUND,
    });
  }
  const classified = classifySqliteError(err, "write");
  if (classified) {
    return classifiedSqliteErrorResponse(c, classified);
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
        columns.map((col) => csvEscape(cellToString(row[col.name]))).join(",") +
          "\n",
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
