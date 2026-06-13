import type { ColumnSchema } from "@sapporta/shared/contracts";
export type DisplayType =
  | "pk"
  | "fk"
  | "select"
  | "checkbox"
  | "date"
  | "timestamp"
  | "number"
  | "currency"
  | "percentage"
  | "text";

export function inferDisplayType(col: ColumnSchema): DisplayType {
  // Relational traits take priority over kind — a numeric FK shows as an FK,
  // a PK shows as a PK, even though both are kind: "number".
  if (col.primary) return "pk";
  if (col.foreignKey) return "fk";
  if (col.select) return "select";
  // Semantic kind + presentation hint. `kind` is always populated — factories
  // stamp it, and extractSchemas() derives it from dataType for hand-declared
  // Drizzle columns. Reports always declare it. There is no dataType fallback.
  if (col.kind === "number") {
    if (col.displayFormat === "currency") return "currency";
    if (col.displayFormat === "percentage") return "percentage";
    return "number";
  }
  if (col.kind === "date") return "date";
  if (col.kind === "timestamp") return "timestamp";
  if (col.kind === "boolean") return "checkbox";
  return "text";
}

export function columnAlign(type: DisplayType): "left" | "center" | "right" {
  if (type === "number" || type === "currency" || type === "percentage")
    return "right";
  if (type === "checkbox") return "center";
  return "left";
}

const DEFAULT_WIDTHS: Partial<Record<DisplayType, number>> = {
  pk: 8,
  fk: 20,
  select: 14,
  checkbox: 5,
  date: 12,
  timestamp: 18,
  number: 10,
  currency: 14,
  percentage: 10,
};

function chCalc(n: number): string {
  return `calc(${n}ch + 1rem)`;
}

/**
 * Convert a display type + optional sizing hints (character counts) into a CSS grid track value.
 *
 * Sizing priority:
 * - width    → fixed: calc(Nch + 1rem)
 * - minWidth / maxWidth → minmax(min, max) with sensible defaults for the missing bound
 * - Type default (DEFAULT_WIDTHS) → fixed for typed columns
 * - Fallback → minmax(0, 1fr) for unsized text columns
 */
export function columnWidth(
  type: DisplayType,
  sizing?: { width?: number; minWidth?: number; maxWidth?: number },
): string {
  const w = sizing?.width;
  const min = sizing?.minWidth;
  const max = sizing?.maxWidth;

  // Explicit fixed width
  if (w != null) return chCalc(w);

  // Flexible with bounds
  if (min != null || max != null) {
    const minVal = min != null ? chCalc(min) : "0";
    const maxVal = max != null ? chCalc(max) : "1fr";
    return `minmax(${minVal}, ${maxVal})`;
  }

  // Type defaults for typed columns (fixed width)
  const defaultChars = DEFAULT_WIDTHS[type];
  if (defaultChars != null) return chCalc(defaultChars);

  // Text columns without sizing → fully flexible
  return "minmax(0, 1fr)";
}

export function isEditable(col: ColumnSchema): boolean {
  // Primary key with default (auto-increment) is not editable
  if (col.primary && col.hasDefault) return false;
  return true;
}
