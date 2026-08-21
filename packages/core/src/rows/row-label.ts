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
