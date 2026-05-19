import { Hono } from "hono";
import type { Context } from "hono";
import { inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { rowLabeller } from "./row-label.js";

/**
 * Handle a lookup request: GET /?ids=1,2,3 or /?q=search
 * Returns { data: { "1": "Display Value", ... } }
 * `ids` wins when present. Without `ids`, optional `q` filters display labels.
 */
export async function handleLookup(
  schema: TableDef,
  db: BetterSQLite3Database,
  c: Context,
) {
  const { pkName, label } = rowLabeller(schema);
  const idsParam = c.req.query("ids");
  const searchText = c.req.query("q")?.trim().toLocaleLowerCase() ?? "";

  let rows: Record<string, unknown>[];
  if (idsParam === undefined) {
    rows = (await db.select().from(schema.drizzle)) as Record<
      string,
      unknown
    >[];
  } else {
    const ids = parseIds(idsParam);
    if (ids.length === 0) return c.json({ data: {} }, 200);
    const pkColumn = (schema.drizzle as Record<string, SQLiteColumn>)[pkName];
    rows = (await db
      .select()
      .from(schema.drizzle)
      .where(inArray(pkColumn, ids))) as Record<string, unknown>[];
  }

  const data: Record<string, string> = {};
  for (const row of rows) {
    const rowLabel = label(row);
    if (
      idsParam === undefined &&
      searchText !== "" &&
      !rowLabel.toLocaleLowerCase().includes(searchText)
    ) {
      continue;
    }
    data[String(row[pkName])] = rowLabel;
  }
  return c.json({ data }, 200);
}

function parseIds(idsParam: string): string[] {
  return idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Create a lookup sub-app (convenience wrapper for tests). */
export function lookupEndpoint(schema: TableDef, db: BetterSQLite3Database) {
  const app = new Hono();
  app.get("/", (c) => handleLookup(schema, db, c));
  return app;
}
