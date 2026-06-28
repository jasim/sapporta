// ---------------------------------------------------------------------------
// CLI table formatting helpers.
//
// Command execution and output selection live under cli/render/. This module
// only contains reusable table-oriented presentation helpers.
// ---------------------------------------------------------------------------

export type OutputFormat = "table" | "json";

/**
 * Format rows as a readable table for terminal output.
 */
export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(empty)";

  const columns = Object.keys(rows[0]);
  const widths = columns.map((col) => {
    const values = rows.map((row) => String(row[col] ?? "NULL"));
    return Math.max(col.length, ...values.map((v) => v.length));
  });

  const header = columns.map((col, i) => col.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) =>
    columns
      .map((col, i) => String(row[col] ?? "NULL").padEnd(widths[i]))
      .join("  "),
  );

  return [header, separator, ...body].join("\n");
}

/**
 * Truncate long string values in result rows to prevent context window overflow.
 * Only affects string values longer than maxLen; other types are left as-is.
 * Returns new row objects (does not mutate the originals).
 */
export function truncateValues(
  rows: Record<string, unknown>[],
  maxLen: number = 200,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const truncated: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && value.length > maxLen) {
        truncated[key] = value.slice(0, maxLen) + "...";
      } else {
        truncated[key] = value;
      }
    }
    return truncated;
  });
}
