// Sort codecs and editors for the host. Speaks the grid's canonical
// `SortDescriptor` vocabulary; adds URL grammar, header-click cycling, and
// structural equality on top.

import type { ColId, SortDescriptor } from "@/grid";

export function parseSortString(
  s: string | null | undefined,
  validColIds: ReadonlySet<ColId>,
): SortDescriptor[] {
  if (!s) return [];
  const out: SortDescriptor[] = [];
  const seen = new Set<ColId>();
  for (const raw of s.split(",").map((p) => p.trim())) {
    if (raw === "") continue;
    const desc = raw.startsWith("-");
    const name = desc ? raw.slice(1) : raw;
    if (name === "") {
      throw new Error(`parseSortString: malformed entry '${raw}' in '${s}'`);
    }
    if (!validColIds.has(name as ColId)) {
      throw new Error(
        `parseSortString: unknown column id '${name}' in '${s}' ` +
          `(valid: ${[...validColIds].join(", ")})`,
      );
    }
    const colId = name as ColId;
    if (seen.has(colId)) {
      throw new Error(
        `parseSortString: duplicate column id '${colId}' in '${s}' ` +
          "- each column may appear at most once",
      );
    }
    seen.add(colId);
    out.push({ colId, direction: desc ? "desc" : "asc" });
  }
  return out;
}

export function stringifySortOrder(order: SortDescriptor[]): string | null {
  if (order.length === 0) return null;
  return order
    .map((s) => (s.direction === "desc" ? `-${s.colId}` : s.colId))
    .join(",");
}

export function cycleSort(
  order: SortDescriptor[],
  colId: ColId,
  mode: "replace" | "extend",
): SortDescriptor[] {
  const idx = order.findIndex((s) => s.colId === colId);
  const existing = idx >= 0 ? order[idx] : null;

  if (mode === "extend") {
    if (!existing) return [...order, { colId, direction: "asc" }];
    if (existing.direction === "asc") {
      return order.map((s, i) =>
        i === idx ? { colId: s.colId, direction: "desc" } : s,
      );
    }
    return order.filter((_, i) => i !== idx);
  }

  if (!existing) return [{ colId, direction: "asc" }];
  if (existing.direction === "asc") return [{ colId, direction: "desc" }];
  return [];
}

export function sortOrderEqual(
  a: SortDescriptor[],
  b: SortDescriptor[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].colId !== b[i].colId || a[i].direction !== b[i].direction) {
      return false;
    }
  }
  return true;
}
