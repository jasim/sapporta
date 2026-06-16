/**
 * Row labels — turning a database row into a human-readable string.
 *
 * The "label" of a row is what FK dropdowns, lookup endpoints, and any
 * future drill-through chip needs to render. The rule:
 *
 *   1. Pick the row-label columns:
 *      - explicit `meta.rowLabelColumns` if set, otherwise
 *      - the first text column that is neither the PK nor a FK.
 *   2. Concatenate non-empty values from those columns with a space.
 *   3. If there are no row-label columns or all values are empty, fall back
 *      to the primary key (so pure join tables still render *something*).
 *
 * `rowLabeller(schema)` precomputes the column choice once and returns a
 * `(row) => string` closure — callers don't juggle pk-name + cols + the
 * fallback rule.
 */

import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { TableDef } from "../schema/table.js";
import { findPkColumn } from "../schema/pk.js";

export interface RowLabeller {
  /** SQL name of the primary key column. */
  readonly pkName: string;
  /** SQL names used to build the display label. */
  readonly labelColumns: readonly string[];
  /** Render a row as a human-readable label. */
  readonly label: (row: Record<string, unknown>) => string;
}

/**
 * The row-label columns for a table — explicit override or heuristic.
 * Returns `null` when no text column is available; callers should fall
 * back to the PK in that case (or use `rowLabeller`, which does this
 * automatically).
 */
export function findRowLabelColumns(schema: TableDef): string[] | null {
  if (schema.meta.rowLabelColumns) return schema.meta.rowLabelColumns;

  const config = getTableConfig(schema.drizzle);
  const fkColumns = new Set<string>();
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns[0]) fkColumns.add(ref.columns[0].name);
  }

  for (const col of config.columns) {
    if (col.primary) continue;
    if (fkColumns.has(col.name)) continue;
    if (col.dataType === "string") return [col.name];
  }
  return null;
}

/**
 * Build a labeller for a table. Resolves PK and row-label columns once;
 * the returned `label` closure is cheap to call per row.
 */
export function rowLabeller(schema: TableDef): RowLabeller {
  const pkName = findPkColumn(schema).name;
  const labelCols = findRowLabelColumns(schema) ?? [pkName];

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
