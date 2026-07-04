import type { LevelOptions, PhantomRow } from "../../types/level-row";
import { displayedPhantomRowKey } from "../../types/identity";
import type { ProtoRow } from "../types";

// Append phantom rows after footers (well, technically after data — see runner
// for stage order). Gated by `levelOptions.allowPhantoms`: a level that
// disallows phantoms ignores any phantoms supplied by the runtime, which is
// how reports keep table-only behavior out of their levels.
//
// Phantoms are author-state, separate from the data plane. They never enter a
// `LevelDataSource`; the pipeline reads them directly off the `PhantomChannel`
// for the path it is running. This preserves the invariant that sources only
// know about persisted data.
export function withPhantoms(
  rows: ProtoRow[],
  phantoms: readonly PhantomRow[],
  options: LevelOptions,
): ProtoRow[] {
  if (!options.allowPhantoms || phantoms.length === 0) return rows;
  const out = rows.slice();
  for (const p of phantoms) {
    out.push({
      kind: "phantom",
      rowKey: displayedPhantomRowKey(p.rowKey),
      columns: p.columns,
      source: p,
    });
  }
  return out;
}
