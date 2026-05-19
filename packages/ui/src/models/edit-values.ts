import type { ColumnSchema } from "@sapporta/shared/contracts";
import { parseCellInput } from "./cell-values";
import { inferDisplayType } from "./column-types";

export function parseEditValue(
  column: string,
  value: unknown,
  columns: ColumnSchema[],
): unknown {
  const col = columns.find((c) => c.name === column);
  if (!col) return value;
  const type = inferDisplayType(col);
  if (typeof value === "string") {
    return parseCellInput(value, type);
  }
  return value;
}
