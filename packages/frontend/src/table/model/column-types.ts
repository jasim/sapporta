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

export function isEditable(col: ColumnSchema): boolean {
  // Primary key with default (auto-increment) is not editable
  if (col.primary && col.hasDefault) return false;
  return true;
}
