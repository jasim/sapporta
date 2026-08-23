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
      .toZonedDateTime(Temporal.Now.timeZoneId(), {
        disambiguation: "compatible",
      })
      .toInstant(),
  );
}

/**
 * Canonical value -> reading text.
 *
 * The storage shapes are built for machines: fixed-width, always UTC, and
 * punctuated with `T` and `Z` so that comparing two raw strings compares two
 * moments. None of that helps a person scanning a column. Display keeps the
 * fixed width — a date column stays visually aligned — but drops the
 * punctuation and the seconds, and shows an instant on the reader's own wall
 * clock, the same zone the datetime-local codec above writes in.
 *
 * How much of a moment to show is the caller's decision, not the value's: a
 * `date` column asks for `"day"` and a `timestamp` column asks for `"minute"`,
 * so that a column renders the same shape in every row even when the values
 * underneath it vary.
 */
export type TemporalDisplayPrecision = "day" | "minute";

export function formatPlainDateForDisplay(value: string): string {
  return formatPlainDate(parsePlainDate(value));
}

export function formatInstantForDisplay(
  value: string,
  precision: TemporalDisplayPrecision = "minute",
): string {
  const local = localWallClock(value);
  const date = formatPlainDate(local.toPlainDate());
  if (precision === "day") return date;
  return `${date} ${local.toPlainTime().toString({ smallestUnit: "minute" })}`;
}

/**
 * The full moment, for a tooltip or a detail line.
 *
 * Display text drops the seconds, so two rows a few seconds apart read alike.
 * This is the text that tells them apart: the same local wall clock at second
 * precision, followed by the offset that names which wall clock it is. An
 * offset rather than a zone name because the offset is what makes the moment
 * reconstructible — `2024-01-15 18:04:56 (UTC+05:30)` denotes one instant to a
 * reader in any zone, which a screenshot of the cell alone does not.
 *
 * Returns `null` for a value that is not an instant, including a plain date:
 * a calendar date has no moment to describe.
 */
export function describeInstantForDisplay(value: string): string | null {
  try {
    const local = localWallClock(value);
    const date = formatPlainDate(local.toPlainDate());
    const time = local.toPlainTime().toString({ smallestUnit: "second" });
    return `${date} ${time} (UTC${local.offset})`;
  } catch {
    return null;
  }
}

const PLAIN_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format whichever canonical shape the value carries at the requested
 * precision, or report that it carries neither by returning `null`.
 *
 * Precision is a ceiling, not a promise: a plain date asked for `"minute"`
 * still renders as a date, because a calendar date carries no time to show.
 *
 * Use this where the value arrives untyped — a report column whose SQL decides
 * the shape — and the renderer has to decide what it is looking at. A `null`
 * result means "not a moment I can vouch for": show the text as it came rather
 * than inventing a date out of it.
 */
export function formatTemporalForDisplay(
  value: string,
  precision: TemporalDisplayPrecision,
): string | null {
  try {
    return PLAIN_DATE_SHAPE.test(value)
      ? formatPlainDateForDisplay(value)
      : formatInstantForDisplay(value, precision);
  } catch {
    return null;
  }
}

/**
 * Canonical instant <-> browser date input codec.
 *
 * A `<input type="date">` speaks calendar dates, so pointing one at a
 * timestamp column means naming a local day and then asking which edge of that
 * day the caller wants. `"startOfDay"` is the first instant of the day and
 * `"endOfDay"` the last; storage is whole seconds, so `23:59:59` is the last
 * moment a stored value can occupy.
 *
 * Both edges are resolved in the reader's zone — the same zone the display
 * codecs above read in, so a row that reads `2024-01-16 02:00` falls inside a
 * filter bounded by the 16th rather than the 15th.
 */
export type LocalDayBound = "startOfDay" | "endOfDay";

export function formatInstantForDateInput(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    return formatPlainDate(localWallClock(value).toPlainDate());
  } catch {
    return "";
  }
}

export function parseDateInputToInstantString(
  value: string,
  bound: LocalDayBound,
): string | null {
  if (value === "") return null;
  const plainTime =
    bound === "startOfDay"
      ? { hour: 0, minute: 0, second: 0 }
      : { hour: 23, minute: 59, second: 59 };
  return formatCanonicalInstant(
    parsePlainDate(value)
      .toZonedDateTime({ timeZone: Temporal.Now.timeZoneId(), plainTime })
      .toInstant(),
  );
}

function localWallClock(value: string): Temporal.ZonedDateTime {
  return parseCanonicalInstant(value).toZonedDateTimeISO(
    Temporal.Now.timeZoneId(),
  );
}
