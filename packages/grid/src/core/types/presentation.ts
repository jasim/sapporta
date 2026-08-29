import type { ColumnSchema } from "./schema";

// Presentation is render state — the runtime never stores it. The render
// layer passes it at each call boundary that needs it, the way an event
// carries its modifier keys. This module owns the column order a
// presentation imposes, so render and navigation can never disagree.
export type GridPresentation = "tabular" | "cards";

// Schema producers stamp `meta.cardRole: "title"` on the column that renders
// as the card's heading.
export function cardRoleOf(column: ColumnSchema): string | undefined {
  if (typeof column.meta !== "object" || column.meta === null) return undefined;
  const value = (column.meta as Record<string, unknown>).cardRole;
  return typeof value === "string" ? value : undefined;
}

// Tabular renders schema order; cards hoist the title column first. Keyboard
// traversal reads this same projection, so it walks what the user sees.
export function presentationColumnOrder(
  columns: readonly ColumnSchema[],
  presentation: GridPresentation,
): readonly ColumnSchema[] {
  if (presentation !== "cards") return columns;
  const titleIndex = columns.findIndex(
    (column) => cardRoleOf(column) === "title",
  );
  if (titleIndex <= 0) return columns;
  return [
    columns[titleIndex],
    ...columns.slice(0, titleIndex),
    ...columns.slice(titleIndex + 1),
  ];
}
