import { Hono } from "hono";
import type { Context } from "hono";
import { stream } from "hono/streaming";
import { asc, eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import type { SchemaRegistry } from "../schema/registry.js";
import type { RowId } from "@sapporta/shared/row-id";
import { findPkColumn } from "../schema/pk.js";
import { savePipeline } from "./save-pipeline.js";
import { parseQuery, type ParsedQuery } from "./query-parser.js";
import { csvEscape, cellToString } from "./csv.js";
import { ValidationError, QueryParseError } from "../db/errors.js";
import { logger } from "../db/logger.js";

const log = logger.child({ module: "crud" });

// ---------------------------------------------------------------------------
// Standalone handler functions for CRUD operations.
//
// Called by the tables API router (tables-api.ts) which resolves the schema
// from the registry on each request. Each handler computes config/pkCol per-call
// rather than closing over them — the overhead is negligible (synchronous
// property lookups on small arrays).
// ---------------------------------------------------------------------------

/** Resolve primary key column and its Drizzle reference. */
function resolvePk(schema: TableDef) {
  const pkCol = findPkColumn(schema);
  const drizzlePk = (schema.drizzle as any)[pkCol.name];
  return { pkCol, drizzlePk };
}

/** Apply the canonical ORDER BY: explicit user sort, else schema.meta.defaultSort,
 *  else PK ascending. The PK fallback keeps re-fetched rows in stable order so
 *  inline cell edits don't visually reorder rows in the grid. */
function applyOrderBy<Q extends { orderBy: (...s: SQL[]) => Q }>(
  q: Q,
  query: ParsedQuery,
  schema: TableDef,
  drizzlePk: AnyColumn,
): Q {
  if (query.orderBy.length > 0) return q.orderBy(...query.orderBy);
  if (schema.meta.defaultSort) return q.orderBy(schema.meta.defaultSort);
  return q.orderBy(asc(drizzlePk));
}

/** GET / — list with filters, sort, pagination. */
export async function handleList(schema: TableDef, db: any, c: Context) {
  const pk = resolvePk(schema);

  const params = Object.fromEntries(
    new URL(c.req.url).searchParams.entries(),
  );
  let query;
  try {
    query = parseQuery(params, schema);
  } catch (err) {
    if (err instanceof QueryParseError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }

  let q = db.select().from(schema.drizzle);
  if (query.where) {
    q = q.where(query.where);
  }

  // Count total rows matching filters (before pagination)
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.drizzle)
    .where(query.where ?? sql`TRUE`);
  const total = Number(countResult[0].count);

  q = applyOrderBy(q, query, schema, pk.drizzlePk);

  q = q.limit(query.limit).offset(query.offset);
  const rows = await q;

  return c.json({
    data: rows,
    meta: {
      total,
      page: Math.floor(query.offset / query.limit) + 1,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  }, 200);
}

/** GET /export.csv — stream every row matching filters/sort as CSV.
 *  Intentionally ignores limit/offset — the export always covers the full
 *  filtered result set. Rows are materialized via drizzle's .all() and
 *  streamed out line-by-line; the CSV text itself is never buffered. */
export async function handleExportCsv(schema: TableDef, db: any, c: Context) {
  const pk = resolvePk(schema);

  const params = Object.fromEntries(
    new URL(c.req.url).searchParams.entries(),
  );
  let query;
  try {
    query = parseQuery(params, schema);
  } catch (err) {
    if (err instanceof QueryParseError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    throw err;
  }

  const columns = getTableConfig(schema.drizzle).columns;

  let q = db.select().from(schema.drizzle);
  if (query.where) q = q.where(query.where);
  q = applyOrderBy(q, query, schema, pk.drizzlePk);

  const rows = q.all();

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${schema.sqlName}.csv"`,
  );

  return stream(c, async (s) => {
    await s.write(columns.map((col) => csvEscape(col.name)).join(",") + "\n");
    for (const row of rows) {
      await s.write(
        columns
          .map((col) => csvEscape(cellToString((row as Record<string, unknown>)[col.name])))
          .join(",") + "\n",
      );
    }
  });
}

/** GET /:id — single row by primary key. */
export async function handleGet(schema: TableDef, db: any, c: Context, id: RowId) {
  const pk = resolvePk(schema);

  const rows = await db
    .select()
    .from(schema.drizzle)
    .where(eq(pk.drizzlePk, id));

  if (rows.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ data: rows[0] }, 200);
}

/** POST / — create one or more records via the save pipeline.
 *  Accepts a single object or an array of objects.
 *  When the body includes a `$details` field, treats it as a master-detail insert
 *  (requires registry to resolve the detail table's schema). */
export async function handleCreate(
  schema: TableDef,
  db: any,
  c: Context,
  opts?: { registry?: SchemaRegistry },
) {
  const body = await c.req.json();
  log.debug("Create request", { table: schema.sqlName, body });
  try {
    // Master-detail insert: body has $details field
    if (body.$details && !Array.isArray(body)) {
      if (!opts?.registry) {
        return c.json({ error: "Master-detail inserts require a schema registry" }, 500);
      }
      return await handleMasterDetailCreate(schema, db, c, body, opts.registry);
    }

    // Batch or single insert
    const records = Array.isArray(body) ? body : [body];
    const results = [];
    for (const record of records) {
      results.push(await savePipeline(schema, db, record));
    }
    return c.json({ data: results.length === 1 ? results[0] : results }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      log.warn("Create validation failed", { table: schema.sqlName, errors: err.errors });
      return c.json({ error: "Validation failed", details: err.errors }, 422);
    }
    throw err;
  }
}

/** Master-detail insert: insert master record, then detail records with FK backfill.
 *  Everything runs inside a single Drizzle transaction. */
async function handleMasterDetailCreate(
  masterSchema: TableDef,
  db: any,
  c: Context,
  body: Record<string, unknown>,
  registry: SchemaRegistry,
) {
  const { $details, ...masterData } = body;
  const details = $details as { table: string; fk: string; rows: Record<string, unknown>[] };

  if (!details.table || !details.fk || !Array.isArray(details.rows)) {
    return c.json(
      { error: "$details must have: table (string), fk (string), rows (array)" },
      400,
    );
  }

  // Resolve detail table schema from registry
  const detailEntry = registry.get(details.table);
  if (!detailEntry) {
    return c.json({ error: `Detail table "${details.table}" not found` }, 404);
  }
  const detailSchema = detailEntry.def;

  // Resolve master PK column name
  const masterPkCol = findPkColumn(masterSchema);

  // Run everything in a transaction
  const result = await db.transaction(async (tx: any) => {
    // Insert master record
    const masterResult = await savePipeline(masterSchema, tx, masterData as Record<string, unknown>);
    const masterPkValue = (masterResult as any)[masterPkCol.name];

    // Insert detail records with FK backfill
    const detailResults = [];
    for (const row of details.rows) {
      const detailRow = { ...row, [details.fk]: masterPkValue };
      detailResults.push(await savePipeline(detailSchema, tx, detailRow));
    }

    return { master: masterResult, details: detailResults };
  });

  return c.json({ data: result }, 201);
}

/** PUT /:id — update an existing record. Rejects if table is immutable. */
export async function handleUpdate(schema: TableDef, db: any, c: Context, id: RowId) {
  if (schema.meta.immutable) {
    return c.json({ error: "Records in this table are immutable" }, 403);
  }

  const body = await c.req.json();
  log.debug("Update request", { table: schema.sqlName, id, body });
  try {
    const result = await savePipeline(schema, db, body, id);
    return c.json({ data: result }, 200);
  } catch (err) {
    if (err instanceof ValidationError) {
      log.warn("Update validation failed", { table: schema.sqlName, id, errors: err.errors });
      return c.json({ error: "Validation failed", details: err.errors }, 422);
    }
    if (err instanceof Error && err.message.includes("not found")) {
      return c.json({ error: "Not found" }, 404);
    }
    throw err;
  }
}

/** DELETE /:id — delete a record. Rejects if table is immutable. */
export async function handleDelete(schema: TableDef, db: any, c: Context, id: RowId) {
  if (schema.meta.immutable) {
    return c.json({ error: "Records in this table are immutable" }, 403);
  }

  const pk = resolvePk(schema);

  const deleted = await db
    .delete(schema.drizzle)
    .where(eq(pk.drizzlePk, id))
    .returning();

  if (deleted.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ data: deleted[0] }, 200);
}

/**
 * Create a CRUD sub-app for a table schema (convenience wrapper for tests).
 * Production routing uses the dynamic router which calls handlers directly.
 */
export function crud(schema: TableDef, db: any) {
  const app = new Hono();

  app.get("/", (c) => handleList(schema, db, c));
  app.get("/export.csv", (c) => handleExportCsv(schema, db, c));
  app.get("/:id", (c) => handleGet(schema, db, c, c.req.param("id")));
  app.post("/", (c) => handleCreate(schema, db, c));
  app.put("/:id", (c) => handleUpdate(schema, db, c, c.req.param("id")));
  app.delete("/:id", (c) => handleDelete(schema, db, c, c.req.param("id")));

  return app;
}
