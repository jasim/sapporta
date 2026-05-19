// RFC 4180: quote cells containing ", comma, CR, or LF; escape " as "".
//
// Deliberately duplicated with packages/ui's grid csvEscape. The UI version
// is coupled to ColDef/GridSlice and can't run server-side, while this one
// is pure string logic called from the export handler. If a third caller
// ever appears, that's the trigger to consolidate.
export function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
