import type { FooterRow } from "../../types/level-row";
import type { ProtoRow } from "../types";

// Append footer rows after the last data/rollup/bracket row. Displayed row kind
// is encoded separately from the footer's source key.
export function withFooters(
  rows: ProtoRow[],
  footers: readonly FooterRow[],
): ProtoRow[] {
  if (footers.length === 0) return rows;
  const out: ProtoRow[] = rows.slice();
  for (const f of footers) {
    out.push({
      kind: "footer",
      rowKey: f.rowKey,
      columns: f.columns,
      source: f,
    });
  }
  return out;
}
