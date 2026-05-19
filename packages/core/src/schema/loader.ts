import { readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { TableDef } from "./table.js";

// SQLite has no native enum type. Enum values are expressed as
// text({ enum: [...] }) directly in column definitions, so there's
// no separate enum object to collect during schema loading.
export interface SchemaLoadResult {
  tables: TableDef[];
}

/**
 * Check if a value looks like a TableDef (duck-typing).
 */
function isTableDef(val: unknown): val is TableDef {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.sqlName === "string" &&
    typeof obj.drizzle === "object" &&
    obj.drizzle !== null &&
    typeof obj.meta === "object"
  );
}

/**
 * Load all schema files from a directory. Each .js file is dynamically
 * imported and scanned for TableDef exports. See app/loader.ts for why
 * the filter is .js-only.
 */
export async function loadSchemas(dir: string): Promise<SchemaLoadResult> {
  const absDir = resolve(dir);
  let files: string[];
  try {
    files = await readdir(absDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return { tables: [] };
    throw err;
  }
  const tables: TableDef[] = [];

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    if (file.endsWith(".test.js")) continue;

    const filePath = join(absDir, file);
    const mod = await import(filePath);

    for (const key of Object.keys(mod)) {
      const val = mod[key];
      if (isTableDef(val)) {
        tables.push(val);
      }
      // No enum detection — SQLite enums are text({ enum }) columns,
      // part of the table definition rather than separate objects.
    }
  }

  return { tables };
}
