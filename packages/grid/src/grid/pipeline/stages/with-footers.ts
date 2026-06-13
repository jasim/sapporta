import type { FooterRow } from "../../types/level-row";
import type { ProtoRow } from "../types";

// Append footer rows after the last data/rollup/bracket row. Footer rowKeys
// are namespaced so they do not collide with data rowKeys.
export function withFooters(
  rows: ProtoRow[],
  footers: FooterRow[],
): ProtoRow[] {
  if (footers.length === 0) return rows;
  const out: ProtoRow[] = rows.slice();
  for (const f of footers) {
    out.push({
      kind: "footer",
      rowKey: `footer:${f.rowKey}`,
      columns: f.columns,
      source: f,
    });
  }
  return out;
}
