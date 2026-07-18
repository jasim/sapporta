/**
 * Structural schemas for values at Sapporta's database-write boundary.
 *
 * Table API payloads reach this boundary after row security has rejected
 * caller-owned policy violations, checked references, and added trusted scope
 * or server values. Direct `scopedRows()` use and master-detail writes converge
 * on the same save pipeline. The insert schema must therefore include every
 * structural column, including required fields that never appear in the public
 * API schema.
 *
 * These schemas reuse `table-value-zod.ts` for every leaf and presence rule.
 * `parseTableWrite()` applies them, runs application validation, and returns
 * the parsed values that the save pipeline sends to Drizzle. API ownership and
 * transport envelopes do not belong to this module.
 */

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  tableZodComponentId,
  zodForInsertField,
  type ColumnValueZod,
  type TableObjectZod,
} from "../schema/table-value-zod.js";
import type { TableDef } from "../schema/table.js";

function insertShape(table: TableDef): Record<string, ColumnValueZod> {
  const shape: Record<string, ColumnValueZod> = {};
  for (const column of getTableConfig(table.drizzle).columns) {
    shape[column.name] = zodForInsertField(table, column);
  }
  return shape;
}

/**
 * Zod projections for trusted table writes.
 *
 * `forInsert()` includes every structural column, including required auth or
 * server-owned fields excluded from the public API. `forPatch()` accepts any
 * structurally valid subset; omitted fields remain unchanged. Both schemas are
 * strict so misspelled or unmapped SQL column names fail before persistence.
 */
export const tableWriteZod = {
  forInsert(table: TableDef): TableObjectZod {
    return z
      .object(insertShape(table))
      .strict()
      .meta({ id: tableZodComponentId(table, "WriteInsert") });
  },

  forPatch(table: TableDef): TableObjectZod {
    return tableWriteZod
      .forInsert(table)
      .partial()
      .meta({ id: tableZodComponentId(table, "WritePatch") });
  },
};
