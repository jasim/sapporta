/**
 * Row labels — turning a database row into a human-readable string.
 *
 * The "label" of a row is what FK dropdowns, lookup endpoints, and any
 * future drill-through chip needs to render. The rule:
 *
 *   1. Pick the row-label columns:
 *      - explicit `meta.rowLabelColumns`.
 *   2. Concatenate non-empty values from those columns with a space.
 *   3. If all label values are empty, fall back to the primary key.
 *
 * `rowLabeller(schema)` precomputes the column choice once and returns a
 * `(row) => string` closure — callers don't juggle pk-name + cols + the
 * fallback rule.
 */

import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { findPkColumn } from "../schema/pk.js";
import { resolveRowFields } from "./row-fields.js";

export interface RowLabeller {
  /** SQL name of the primary key column. */
  readonly pkName: string;
  /** SQL names used to build the display label. */
  readonly labelColumns: readonly string[];
  /** Render a row as a human-readable label. */
  readonly label: (row: Record<string, unknown>) => string;
}

/** The declared row-label columns for a table. */
export function findRowLabelColumns(
  schema: TableDef,
): readonly [string, ...string[]] {
  return schema.meta.rowLabelColumns;
}

/**
 * Build a labeller for a table. Resolves PK and row-label columns once;
 * the returned `label` closure is cheap to call per row.
 */
export function rowLabeller(schema: TableDef): RowLabeller {
  const pkName = findPkColumn(schema).name;
  const labelCols = findRowLabelColumns(schema);

  const label = (row: Record<string, unknown>): string => {
    const parts: string[] = [];
    for (const col of labelCols) {
      const v = row[col];
      if (v != null && v !== "") parts.push(String(v));
    }
    if (parts.length > 0) return parts.join(" ");
    return String(row[pkName]);
  };

  return { pkName, labelColumns: labelCols, label };
}

/**
 * A column value as text, printed the way JavaScript's `String(v)` prints
 * the value read from the database. SQLite's own cast prints a whole real
 * number as `1.0`, where `String(1)` gives `1`, so a whole real is cast to
 * an integer first. Text and integers cast unchanged.
 */
export function labelValueSql(column: SQLiteColumn): SQL {
  return sql`(case when typeof(${column}) = 'real' and ${column} = cast(${column} as integer) then cast(cast(${column} as integer) as text) else cast(${column} as text) end)`;
}

/**
 * The SQL twin of `rowLabeller(schema).label`: the row-label columns of the
 * current row joined by a single space, with NULL and empty parts skipped,
 * falling back to the primary key as text. Column references are those of
 * the table itself, so the expression belongs in a query that reads the
 * table once in its `from` clause.
 */
export function rowLabelSql(schema: TableDef): SQL {
  const pk = findPkColumn(schema);
  const columns = Object.values(
    resolveRowFields(schema, findRowLabelColumns(schema)).databaseSelection,
  );
  let joined: SQL | null = null;
  for (const column of columns) {
    const part = sql`nullif(${labelValueSql(column)}, '')`;
    // `a || ' ' || b` is NULL when either side is NULL, so coalesce keeps
    // whichever side has a value.
    joined =
      joined === null
        ? part
        : sql`coalesce(${joined} || ' ' || ${part}, ${joined}, ${part})`;
  }
  const fallback = labelValueSql(pk);
  return joined === null ? fallback : sql`coalesce(${joined}, ${fallback})`;
}
