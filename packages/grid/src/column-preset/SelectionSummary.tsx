import type { GridSelectionSummaryContext } from "../core/react";
import type { LevelRow } from "../core/types/level-row";
import type { ColumnSchema } from "../core/types/schema";
import { finiteNumericValue } from "./numeric";
import { presetRuntime } from "./preset";
import styles from "./sapporta-preset.module.css";

/**
 * Renders the selection summary supplied by `columnPreset.chrome()`.
 *
 * A sum appears under each selected numeric column. Other preset kinds and
 * card presentations leave this area empty.
 */
export function ColumnPresetSelectionSummary({
  presentation,
  rowHeaderColumn,
  selection,
  schema,
}: GridSelectionSummaryContext) {
  if (presentation !== "tabular") return null;

  const summaries = selection.columns.flatMap((column) => {
    const text = selectionSumForColumn(column, selection.rows);
    return text === null ? [] : [{ column, text }];
  });
  if (summaries.length === 0) return null;

  const summariesByColumn = new Map(
    summaries.map(({ column, text }) => [column.id, text]),
  );
  return (
    <div
      className={styles.selectionSummary}
      data-grid-part="selection-summary"
      data-grid-presentation="tabular"
    >
      {rowHeaderColumn === "empty-selectable-cell" ? (
        <div
          className={styles.selectionSummaryCell}
          data-grid-part="selection-summary-row-header"
        />
      ) : null}
      {schema.map((column) => {
        const text = summariesByColumn.get(column.id);
        return (
          <div
            className={styles.selectionSummaryCell}
            data-col-id={column.id}
            data-grid-part="selection-summary-column"
            key={column.id}
          >
            {text !== undefined ? (
              <div className={styles.selectionSummaryContent}>
                <span className={styles.selectionSummaryLabel}>Sum</span>
                <span className={styles.selectionSummaryValue}>{text}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Produces the formatted sum shown for one selected preset column.
 *
 * This returns `null` when the column is not numeric or the selected rows do
 * not contain a finite numeric value.
 */
export function selectionSumForColumn(
  column: ColumnSchema,
  rows: readonly LevelRow[],
): string | null {
  const runtime = presetRuntime(column);
  if (!runtime) return null;
  const kind = runtime.preset.kind;
  if (kind !== "number" && kind !== "currency" && kind !== "percentage") {
    return null;
  }

  let hasNumber = false;
  let total = 0;
  for (const row of rows) {
    const value = finiteNumericValue(row.columns[column.id]);
    if (value === null) continue;
    hasNumber = true;
    total += value;
  }
  return hasNumber ? runtime.valueCodec.format(total) : null;
}
