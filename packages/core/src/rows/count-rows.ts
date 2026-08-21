import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  DEFAULT_COUNT_GROUP_LIMIT,
  MAX_COUNT_GROUPS,
  type GroupCount,
} from "@sapporta/shared";
import type { TableDef } from "../schema/table.js";
import { zodForColumnValue } from "../schema/table-value-zod.js";

export interface CountTableRowsByInput {
  column: SQLiteColumn;
  order?: "asc" | "desc";
  limit?: number;
}

export async function countTableRows(
  db: BetterSQLite3Database,
  table: TableDef,
  where: SQL,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(table.drizzle)
    .where(where);
  return Number(rows[0]?.count ?? 0);
}

export async function countTableRowsBy(
  db: BetterSQLite3Database,
  table: TableDef,
  input: CountTableRowsByInput,
  scopedWhere: SQL,
): Promise<GroupCount[]> {
  assertTableColumn(table, input.column);
  const { order, limit } = normalizedGroupOptions(input);
  const countExpression = sql<number>`count(*)`;
  const rows = await db
    .select({ value: input.column, count: countExpression })
    .from(table.drizzle)
    .where(scopedWhere)
    .groupBy(input.column)
    .orderBy(
      order === "asc" ? asc(countExpression) : desc(countExpression),
      asc(input.column),
    )
    .limit(limit);

  return rows.map((row) => ({
    value: groupValue(table, input.column, row.value),
    count: Number(row.count),
  }));
}

function normalizedGroupOptions(input: CountTableRowsByInput): {
  order: "asc" | "desc";
  limit: number;
} {
  const order = input.order ?? "desc";
  if (order !== "asc" && order !== "desc") {
    throw new TypeError('Count order must be "asc" or "desc".');
  }

  const limit = input.limit ?? DEFAULT_COUNT_GROUP_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COUNT_GROUPS) {
    throw new RangeError(
      `Count limit must be an integer from 1 to ${MAX_COUNT_GROUPS}.`,
    );
  }
  return { order, limit };
}

function assertTableColumn(table: TableDef, column: SQLiteColumn): void {
  if (!getTableConfig(table.drizzle).columns.includes(column)) {
    throw new Error(
      `Count group column "${column.name}" does not belong to table "${table.sqlName}".`,
    );
  }
}

function groupValue(
  table: TableDef,
  column: SQLiteColumn,
  value: unknown,
): GroupCount["value"] {
  const parsed = zodForColumnValue(table, column).nullable().parse(value);
  if (
    parsed === null ||
    typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean"
  ) {
    return parsed;
  }
  throw new Error(`Unsupported count group value type: ${typeof parsed}`);
}
