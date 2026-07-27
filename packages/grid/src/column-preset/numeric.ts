/**
 * Reads the numeric value understood by number, currency, and percentage
 * presets. Formatting, sorting, rendering, and summaries use this rule so the
 * same cell value is not interpreted differently across those surfaces.
 */
export function finiteNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
