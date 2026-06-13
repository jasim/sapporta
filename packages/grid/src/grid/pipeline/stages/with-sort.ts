import type { ColumnSchema } from "../../types/schema";
import type { ProtoRow, SortDescriptor } from "../types";
import { makeRowComparator } from "./sort-impl";

// Sort data rows globally; non-data rows (brackets, footers, phantoms) are
// anchors that retain their original positions in the row sequence. Each
// data row carries its trailing rollup so the two move together.
export function withSort(
  rows: ProtoRow[],
  sort: SortDescriptor[] | undefined,
  columns: ColumnSchema[],
): ProtoRow[] {
  if (!sort || sort.length === 0) return rows;
  const cmp = makeRowComparator(sort, columns);

  type Group = { lead: ProtoRow; rollup: ProtoRow | null };
  type Slot = { kind: "data" } | { kind: "other"; row: ProtoRow };

  // Walk once; collect data groups in source order plus the slot pattern.
  // Bare rollups (rollup not following its data row) are unexpected — they
  // become anchors so projected rows stay well-formed.
  const groups: Group[] = [];
  const slots: Slot[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === "data") {
      const next = rows[i + 1];
      const rollup =
        next && next.kind === "rollup" && next.source === r.source
          ? next
          : null;
      groups.push({ lead: r, rollup });
      slots.push({ kind: "data" });
      if (rollup) i++;
    } else {
      slots.push({ kind: "other", row: r });
    }
  }

  groups.sort((a, b) => cmp(a.lead.columns, b.lead.columns));

  const out: ProtoRow[] = [];
  let g = 0;
  for (const slot of slots) {
    if (slot.kind === "data") {
      const grp = groups[g++];
      out.push(grp.lead);
      if (grp.rollup) out.push(grp.rollup);
    } else {
      out.push(slot.row);
    }
  }
  return out;
}
