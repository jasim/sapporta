import type { GridPath } from "../../types/identity";
import { makeLevelRowId } from "../../types/identity";
import { capabilitiesFor } from "../../types/capabilities";
import type { LevelRow } from "../../types/level-row";
import type { ProtoRow } from "../types";

// Resolve final RowIds. Identity is a tagged function of (path, kind, rowKey),
// so reordering the array does not move RowIds and generated row kinds cannot
// collide with application data keys.
export function withRowIds(rows: ProtoRow[], path: GridPath): LevelRow[] {
  const out: LevelRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = makeLevelRowId(path, r.kind, r.rowKey);
    const rowSelectable = capabilitiesFor(r.kind).rowSelectable;
    switch (r.kind) {
      case "data":
        out[i] = {
          kind: "data",
          id,
          rowSelectable,
          columns: r.columns,
          hasChildren: r.hasChildren,
          source: r.source,
        };
        break;
      case "rollup":
        out[i] = {
          kind: "rollup",
          id,
          rowSelectable,
          columns: r.columns,
          source: r.source,
        };
        break;
      case "opening":
      case "closing":
      case "subtotal":
        out[i] = {
          kind: r.kind,
          id,
          rowSelectable,
          columns: r.columns,
          source: r.source,
        };
        break;
      case "footer":
        out[i] = {
          kind: "footer",
          id,
          rowSelectable,
          columns: r.columns,
          source: r.source,
        };
        break;
      case "phantom":
        out[i] = {
          kind: "phantom",
          id,
          rowSelectable,
          columns: r.columns,
          source: r.source,
        };
        break;
    }
  }
  return out;
}
