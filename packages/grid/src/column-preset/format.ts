import {
  describeInstantForDisplay,
  formatTemporalForDisplay,
  type TemporalDisplayPrecision,
} from "@sapporta/shared/temporal";

import { finiteNumericValue } from "./numeric";

export function formatText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number === null
    ? String(value)
    : new Intl.NumberFormat().format(number);
}

export function formatCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number !== null
    ? new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number)
    : String(value);
}

export function formatPercentage(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number !== null
    ? new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(number)
    : String(value);
}

/**
 * Render a date or a timestamp for reading.
 *
 * Values reach the grid in their canonical wire shape — `2026-08-23` for a
 * date, `2026-08-23T11:08:00Z` for a timestamp — which is precise but slow to
 * read across a column. A date reads as `2026-08-23` and a timestamp as
 * `2026-08-23 16:38` on the reader's own wall clock.
 *
 * Which of the two a column uses comes from the column's declared kind, not
 * from the value in the cell, so every row of a column reads the same way even
 * where the values underneath vary. The value's shape decides only how much
 * there is to show: a date has no time for `formatTimestamp` to print, and an
 * instant in a date column is reduced to the calendar day it falls on.
 *
 * Text in neither canonical shape is shown exactly as it arrived, so
 * unexpected data — a report column whose SQL emits `2026-08` — stays visible
 * instead of being blanked or guessed at.
 */
export function formatDate(value: unknown): string {
  return formatTemporal(value, "day");
}

export function formatTimestamp(value: unknown): string {
  return formatTemporal(value, "minute");
}

/**
 * The exact moment behind a timestamp cell, for a tooltip.
 *
 * Cell text stops at the minute, which is enough to scan a column and not
 * enough to tell two rows a few seconds apart from one another. This is the
 * rest of it: seconds, plus the offset that says which wall clock the cell is
 * printed on. `undefined` for anything that is not an instant.
 */
export function describeInstant(value: unknown): string | undefined {
  const canonical = canonicalText(value);
  if (canonical === null) return undefined;
  return describeInstantForDisplay(canonical) ?? undefined;
}

function formatTemporal(
  value: unknown,
  precision: TemporalDisplayPrecision,
): string {
  if (value === null || value === undefined || value === "") return "";
  const canonical = canonicalText(value);
  const formatted =
    canonical === null ? null : formatTemporalForDisplay(canonical, precision);
  return formatted ?? String(value);
}

/**
 * Reduce a cell value to the canonical text the temporal codecs read.
 *
 * A `Date` is an instant, so it is serialized as one rather than having a
 * calendar date sliced off its UTC face: slicing would print the UTC day for a
 * value whose time is displayed on the reader's clock, which is how the same
 * column ends up disagreeing with itself about which day a row belongs to.
 */
function canonicalText(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return typeof value === "string" ? value : null;
}
