/**
 * CSV serialization shared by the server's table export and the grid's
 * clipboard copy.
 */

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function cellToCsvString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function csvRow(values: readonly unknown[]): string {
  return values.map((value) => csvEscape(cellToCsvString(value))).join(",");
}
