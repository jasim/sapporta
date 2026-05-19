import { Hono } from "hono";
import type { Context } from "hono";
import { sql, inArray } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";

/**
 * Handle a count request: GET /?group_by=fk_col&ids=1,2,3
 * Returns grouped counts: { data: { "1": 3, "2": 5 } }
 * Used by the UI to show child record counts in parent grids.
 */
export async function handleCount(schema: TableDef, db: any, c: Context) {
  const groupBy = c.req.query("group_by");
  const idsParam = c.req.query("ids");

  if (!groupBy || !idsParam) {
    return c.json({ data: {} }, 200);
  }

  // Validate that the groupBy column exists
  const config = getTableConfig(schema.drizzle);
  const col = config.columns.find((col) => col.name === groupBy);
  if (!col) {
    return c.json({ error: `Column "${groupBy}" not found` }, 400);
  }

  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return c.json({ data: {} }, 200);
  }

  const drizzleCol = (schema.drizzle as any)[groupBy];

  const rows = await db
    .select({
      groupKey: drizzleCol,
      count: sql<number>`count(*)`,
    })
    .from(schema.drizzle)
    .where(inArray(drizzleCol, ids))
    .groupBy(drizzleCol);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[String(row.groupKey)] = row.count;
  }

  return c.json({ data: result }, 200);
}

/** Create a count sub-app (convenience wrapper for tests). */
export function countEndpoint(schema: TableDef, db: any) {
  const app = new Hono();
  app.get("/", (c) => handleCount(schema, db, c));
  return app;
}
