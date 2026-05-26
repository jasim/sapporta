/**
 * Thin Temporal helpers — the one enforcement point for the "all time
 * handling goes through Temporal" rule.
 *
 * Callers never import `Temporal` directly; they go through these helpers.
 * That gives us a single place to enforce the canonical timestamp shape
 * (fixed-width UTC, no fractional seconds) without having to audit every
 * call site.
 *
 * See docs/DATA-TYPE-PRINCIPLES.md §1 ("Storage maps to SQLite types that
 * behave correctly") and the strict-validity expectations in Part V §5.
 */

import { Temporal } from "@js-temporal/polyfill";

export { Temporal };

/**
 * Parse an ISO `YYYY-MM-DD` string to a `Temporal.PlainDate`.
 *
 * Strict: `"2024-02-30"`, `"2024-13-01"`, `"01/15/2024"` all throw. The
 * grammar is exactly what `Temporal.PlainDate.from` accepts with the
 * default `overflow: "reject"` behavior.
 */
export function parsePlainDate(s: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(s, { overflow: "reject" });
}

/** Format a `Temporal.PlainDate` back to its canonical ISO string. */
export function formatPlainDate(d: Temporal.PlainDate): string {
  return d.toString();
}

/**
 * Canonical instant shape: fixed-width UTC, no fractional seconds,
 * trailing `Z`. Width is what makes raw-string compare equal to
 * chronological order on SQLite TEXT storage.
 */
const CANONICAL_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Parse a timestamp input to a `Temporal.Instant`. Accepts any Temporal-
 * recognizable form (UTC `Z`, offsets, fractional seconds) and
 * re-canonicalizes on the way out through `formatCanonicalInstant`.
 *
 * Impossible instants (`25:00:00`, `+25:00` offset) throw.
 */
export function parseCanonicalInstant(s: string): Temporal.Instant {
  // `Instant.from` is strict about calendar validity and offset shape; we
  // don't need a separate regex guard. Fractional seconds and offsets are
  // accepted here; the *storage* form drops them (see format below).
  return Temporal.Instant.from(s);
}

/**
 * Serialize a `Temporal.Instant` to the canonical `YYYY-MM-DDTHH:mm:ssZ`
 * shape. Fractional seconds are truncated to whole seconds — the storage
 * contract is fixed-width, and that width is the invariant that makes
 * lexicographic sort agree with chronological order.
 */
export function formatCanonicalInstant(i: Temporal.Instant): string {
  // `toString({ smallestUnit: "second" })` always emits `Z` (UTC) when the
  // underlying Instant has no attached time zone, with whole-second
  // precision — exactly the canonical width we want.
  const out = i.toString({ smallestUnit: "second" });
  if (!CANONICAL_INSTANT_RE.test(out)) {
    // Defensive: if Temporal ever emits a different shape for a valid
    // input (e.g. a future version), fail loudly rather than silently
    // storing a value that breaks lex-order.
    throw new Error(
      `formatCanonicalInstant produced non-canonical output: ${JSON.stringify(out)}`,
    );
  }
  return out;
}

/**
 * Round-trip a string through the canonical form. Useful at the boundary
 * for validation-before-store: the stored value is guaranteed fixed-width.
 */
export function canonicalizeInstantString(s: string): string {
  return formatCanonicalInstant(parseCanonicalInstant(s));
}

/**
 * Canonical date <-> browser date input codec.
 *
 * `<input type="date">` already speaks `YYYY-MM-DD`, so the only work here is
 * strict Temporal validation before a value crosses into form state or onto the
 * wire.
 */
export function formatPlainDateForDateInput(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    return formatPlainDate(parsePlainDate(value));
  } catch {
    return "";
  }
}

export function parseDateInputToPlainDateString(value: string): string | null {
  if (value === "") return null;
  return formatPlainDate(parsePlainDate(value));
}

/**
 * Canonical instant <-> browser datetime-local input codec.
 *
 * `datetime-local` is deliberately zone-less wall-clock text. Sapporta stores
 * timestamps as instants, so callers must choose the local time zone at this
 * boundary and immediately serialize back to canonical UTC.
 */
export function formatInstantForDateTimeLocalInput(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    return parseCanonicalInstant(value)
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDateTime()
      .toString({ smallestUnit: "second" });
  } catch {
    return "";
  }
}

export function parseDateTimeLocalInputToCanonicalInstantString(
  value: string,
): string | null {
  if (value === "") return null;
  const localDateTime = Temporal.PlainDateTime.from(value, {
    overflow: "reject",
  });
  return formatCanonicalInstant(
    localDateTime
      .toZonedDateTime(Temporal.Now.timeZoneId(), { disambiguation: "compatible" })
      .toInstant(),
  );
}
