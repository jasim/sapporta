/**
 * Table-value projections exposed by the generated table API.
 *
 * `tableApiZod` describes one caller-supplied insert, one caller-supplied
 * patch, or one returned row. `table-api-contracts.ts` composes those values
 * into HTTP routes, arrays, `{ data }` envelopes, and master-detail payloads.
 * Keeping transport composition there makes "one table value" a stable and
 * reusable concept for application code and generated documentation.
 *
 * Insert and patch shapes contain only fields a table API caller may control.
 * Generated primary keys, auth ownership fields, `apiWritable: false` columns,
 * and server-managed references are absent. `isApiWritableColumn()` projects
 * the same ownership rules that `apiWritePolicyIssues()` enforces at request
 * time, which keeps OpenAPI visibility and server rejection aligned.
 *
 * Generated create and update routes defer request-body Zod validation to the
 * save boundary so auth can add trusted required values first. These schemas
 * still define generated client types and OpenAPI, while auth independently
 * rejects prohibited submitted fields. Public object keys are SQL column names.
 */

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  tableZodComponentId,
  zodForInsertField,
  zodForRowField,
  type ColumnValueZod,
  type TableObjectZod,
} from "../schema/table-value-zod.js";
import type { TableDef } from "../schema/table.js";
import {
  isApiWritableColumn,
  requireResolvedTableReferences,
} from "../auth/schema-validation.js";

function apiWriteShape(
  table: TableDef,
  tables: readonly TableDef[],
): Record<string, ColumnValueZod> {
  const references = requireResolvedTableReferences(table, tables);
  const shape: Record<string, ColumnValueZod> = {};
  for (const column of getTableConfig(table.drizzle).columns) {
    if (!isApiWritableColumn(table, column, references)) continue;
    shape[column.name] = zodForInsertField(table, column);
  }
  return shape;
}

/**
 * Stateless Zod vocabulary for the generated table API boundary.
 *
 * `forInsert()` returns one caller-supplied row accepted for insertion. It is
 * not the create route's object/array/master-detail envelope. `forPatch()` is
 * the same writable field set with patch presence semantics: every field is
 * optional and an absent field remains unchanged. `forRow()` is one complete
 * emitted row, including server-owned columns.
 */
export const tableApiZod = {
  forInsert(table: TableDef, tables: readonly TableDef[]): TableObjectZod {
    return z
      .object(apiWriteShape(table, tables))
      .strict()
      .meta({ id: tableZodComponentId(table, "Insert") });
  },

  forPatch(table: TableDef, tables: readonly TableDef[]): TableObjectZod {
    return z
      .object(apiWriteShape(table, tables))
      .partial()
      .strict()
      .meta({ id: tableZodComponentId(table, "Patch") });
  },

  forRow(table: TableDef): TableObjectZod {
    const shape: Record<string, ColumnValueZod> = {};
    for (const column of getTableConfig(table.drizzle).columns) {
      shape[column.name] = zodForRowField(table, column);
    }
    return z
      .object(shape)
      .strict()
      .meta({ id: tableZodComponentId(table, "Row") });
  },
};
