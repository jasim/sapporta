/**
 * Thin Temporal helpers — the one enforcement point for the "all time
 * handling goes through Temporal" rule.
 *
 * Callers never import `Temporal` directly; they go through these helpers.
 * That gives us a single place to enforce the canonical timestamp shape
 * (fixed-width UTC, no fractional seconds) without having to audit every
 * call site.
 *
 * Storage is always UTC; reading is not. Every codec here that turns an
 * instant into text a person sees, or a person's calendar day back into an
 * instant, takes the time zone as a required argument and holds no state of
 * its own. Nothing in this module reads the device or any ambient holder:
 * the zone is named at the call site, and it comes from the workspace, which
 * the server resolves per request and the browser holds for the page (see
 * `appTimeZone()` in the frontend). The one exception is `deviceTimeZone()`,
 * whose whole job is to report what the device is set to, so that the first
 * workspace an account creates starts on the calendar its owner keeps.
 *
 * The argument is a `TimeZone` rather than a string: an id is checked once,
 * where it arrives, and every codec then takes the checked value. See the
 * type below for why that check cannot usefully live any further in.
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

// ── Display time zone ────────────────────────────────────────────────────

declare const timeZoneBrand: unique symbol;

/**
 * An IANA zone id this runtime can read and do calendar math in.
 *
 * A zone id is a string that can be wrong — a typo, or a name the tz database
 * renamed out from under a stored preference — and a codec that discovers
 * that has already been called from inside a cell renderer, with nowhere to
 * report it and nothing to show but the stored wire text. So the check
 * happens once, wherever a zone id first arrives, and its answer is carried
 * in the type: every codec below takes a `TimeZone` rather than a string, so
 * an unchecked zone cannot reach one and none of them checks again.
 *
 * Obtained from `deviceTimeZone()`, from `parseTimeZone()`, or by narrowing
 * with `isValidTimeZone()`.
 */
export type TimeZone = string & { readonly [timeZoneBrand]: true };

/**
 * The zone the device is set to, for choosing a new workspace's first calendar.
 *
 * Trusted without checking: it is the runtime reporting its own setting, and
 * there is no better answer to fall back to if it were refused.
 *
 * The only reader of an ambient zone in the codebase, with two callers, both
 * choosing a new workspace's first zone and neither displaying it or grouping
 * by it: sign-up, which sends the browser's zone, and a seed run, which has no
 * request to take one from and uses the machine's. Everywhere else names the
 * workspace zone, so that a workspace's calendar reads the same to everyone.
 */
export function deviceTimeZone(): TimeZone {
  return Temporal.Now.timeZoneId() as TimeZone;
}

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

/**
 * Zones that have passed the check, so that asking twice costs one lookup.
 *
 * The caller that needs this is `to_tz_date`, the SQL function that buckets a
 * report by local day: it is handed the zone again on every row, so without
 * the set a scan would resolve the same zone a million times. A zone that
 * failed is not kept: there is one of those per mistake, and the cost of
 * finding out again is what a mistake should cost.
 */
const checkedZones = new Set<string>();

/**
 * Whether the runtime can do calendar math in `zone`.
 *
 * A `true` narrows `zone` to `TimeZone` and covers every codec below: Temporal
 * is the only engine they use, so none of them throws on a zone this accepts.
 *
 * Use it where a `false` is an answer — dropping an id from a picker's list,
 * replying 422 to a submitted one. Where a bad id stops the work, use
 * `parseTimeZone`.
 */
export function isValidTimeZone(zone: string): zone is TimeZone {
  if (checkedZones.has(zone)) return true;
  try {
    // Throws a RangeError for a zone Temporal cannot use; called only for that
    // check, so the result is discarded.
    EPOCH.toZonedDateTimeISO(zone);
  } catch {
    return false;
  }
  checkedZones.add(zone);
  return true;
}

/**
 * `zone` as a checked zone, or an error naming the mistake.
 *
 * Every reader of a stored zone goes through here. A bad id fails the request
 * or the page while the value is still in hand to name; no caller substitutes
 * a zone of its own, because a wrong calendar shows a wrong day and says
 * nothing about it.
 */
export function parseTimeZone(zone: string): TimeZone {
  if (isValidTimeZone(zone)) return zone;
  throw new Error(
    `${JSON.stringify(zone)} is not a time zone this runtime knows. ` +
      `Use an IANA id such as "Asia/Kolkata" or "America/New_York".`,
  );
}

/**
 * Every zone a picker can offer, checked, in the order the runtime lists them.
 *
 * `Intl.supportedValuesOf` is the runtime's own list of canonical IANA ids,
 * and each one is put through `isValidTimeZone` before it is offered. The two
 * do not accept quite the same names: Temporal rejects a handful of legacy
 * aliases ICU still answers for, so a name `Intl` lists is not automatically a
 * name the codecs here can take. A list a reader chooses from must hold only
 * zones that they can.
 *
 * `"UTC"` is not in the list. It is not a canonical IANA id, so `Intl` does
 * not list it; offer it beside the list rather than expecting to find it in
 * there.
 *
 * The check runs on every id, so call this where a picker is opened rather
 * than while a page is loading.
 */
export function supportedTimeZones(): readonly TimeZone[] {
  return Intl.supportedValuesOf("timeZone").filter(isValidTimeZone);
}

/**
 * A short name for a zone, for a chip or a menu entry: `UTC+05:30`,
 * `UTC-07:00`, `UTC`.
 *
 * The offset rather than an abbreviation, because abbreviations exist only for
 * some zones. `Intl`'s short names give `PDT` for Los Angeles but `GMT+5:30`
 * for Kolkata and `GMT+2` for Berlin, so a control built on them would read
 * differently depending on where the reader sits. An offset is uniform, means
 * the same thing to a reader anywhere, and is what a cell's own tooltip names
 * (see `describeInstantForDisplay`). Put the IANA id itself next to it
 * wherever there is room, since an offset alone does not say which zone
 * produced it.
 *
 * The offset is the one in effect at `at`, which defaults to now, so a zone
 * that observes daylight saving reads `UTC-07:00` in July and `UTC-08:00` in
 * January.
 */
export function formatTimeZoneOffsetLabel(
  zone: TimeZone,
  at: Temporal.Instant = Temporal.Now.instant(),
): string {
  const { offset } = at.toZonedDateTimeISO(zone);
  return offset === "+00:00" ? "UTC" : `UTC${offset}`;
}

/**
 * Canonical instant <-> browser datetime-local input codec.
 *
 * `datetime-local` is deliberately zone-less wall-clock text. Sapporta stores
 * timestamps as instants, so callers must choose the time zone at this
 * boundary and immediately serialize back to canonical UTC.
 *
 * Pass the same zone the display codecs are given. An edit form that reads a
 * timestamp in one zone and writes it back in another moves the moment by the
 * difference between them.
 */
export function formatInstantForDateTimeLocalInput(
  value: unknown,
  zone: TimeZone,
): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    return parseCanonicalInstant(value)
      .toZonedDateTimeISO(zone)
      .toPlainDateTime()
      .toString({ smallestUnit: "second" });
  } catch {
    return "";
  }
}

export function parseDateTimeLocalInputToCanonicalInstantString(
  value: string,
  zone: TimeZone,
): string | null {
  if (value === "") return null;
  const localDateTime = Temporal.PlainDateTime.from(value, {
    overflow: "reject",
  });
  return formatCanonicalInstant(
    localDateTime
      .toZonedDateTime(zone, {
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
 * punctuation and the seconds, and shows an instant on the wall clock of the
 * zone the caller names, the same zone the datetime-local codec above writes
 * in.
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

/**
 * The moment `value` names, on the wall clock of `zone`.
 *
 * One engine, both directions. Everything here — an instant to reading text,
 * and a wall clock or a calendar day back to an instant — goes through
 * Temporal, and nothing projects any other way. `Intl.DateTimeFormat` does the
 * outbound half about three times faster, but the saving is a few microseconds
 * on a cell, and taking it means assembling the text out of `formatToParts`:
 * a pinned locale so no CLDR difference changes the output, a named hour cycle
 * so no runtime writes midnight as `24:00`, a padded year, and a test sweep to
 * prove the assembly still agrees with the Temporal that produced the bounds it
 * is compared against. One engine needs none of that, and a cell and its own
 * tooltip cannot disagree when both are read off one `ZonedDateTime`.
 *
 * Parsing is strict for the same reason it is elsewhere in this module: a
 * display has no business inventing a date for `2024-02-30`, which is what
 * `Date.parse` does when it answers March 1.
 */
function wallClockIn(value: string, zone: TimeZone): Temporal.ZonedDateTime {
  return parseCanonicalInstant(value).toZonedDateTimeISO(zone);
}

export function formatInstantForDisplay(
  value: string,
  precision: TemporalDisplayPrecision,
  zone: TimeZone,
): string {
  const local = wallClockIn(value, zone);
  const day = formatPlainDate(local.toPlainDate());
  if (precision === "day") return day;
  return `${day} ${local.toPlainTime().toString({ smallestUnit: "minute" })}`;
}

/**
 * The full moment, for a tooltip or a detail line.
 *
 * Display text drops the seconds, so two rows a few seconds apart read alike.
 * This is the text that tells them apart: the same wall clock at second
 * precision, followed by the offset that names which wall clock it is. An
 * offset rather than a zone name because the offset is what makes the moment
 * reconstructible — `2024-01-15 18:04:56 (UTC+05:30)` denotes one instant to a
 * reader in any zone, which a screenshot of the cell alone does not.
 *
 * The wall clock here is the same projection the cell text came from, so a
 * tooltip cannot contradict the cell it is describing.
 *
 * Returns `null` for a value that is not an instant, including a plain date:
 * a calendar date has no moment to describe.
 */
export function describeInstantForDisplay(
  value: string,
  zone: TimeZone,
): string | null {
  try {
    const local = wallClockIn(value, zone);
    const day = formatPlainDate(local.toPlainDate());
    const time = local.toPlainTime().toString({ smallestUnit: "second" });
    return `${day} ${time} (UTC${local.offset})`;
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
 * A plain date is also unaffected by `zone`, for the same reason.
 *
 * Use this where the value arrives untyped — a report column whose SQL decides
 * the shape — and the renderer has to decide what it is looking at. A `null`
 * result means "not a moment I can vouch for": show the text as it came rather
 * than inventing a date out of it.
 */
export function formatTemporalForDisplay(
  value: string,
  precision: TemporalDisplayPrecision,
  zone: TimeZone,
): string | null {
  try {
    return PLAIN_DATE_SHAPE.test(value)
      ? formatPlainDateForDisplay(value)
      : formatInstantForDisplay(value, precision, zone);
  } catch {
    return null;
  }
}

/**
 * Canonical instant <-> browser date input codec.
 *
 * A `<input type="date">` speaks calendar dates, so pointing one at a
 * timestamp column means naming a day and then asking which edge of that day
 * the caller wants. `"startOfDay"` is the first instant of the day and
 * `"endOfDay"` the last one a stored value can occupy.
 *
 * Both edges are derived from where the day *begins* — its own start, or one
 * second before the next day's. Neither is built from a wall-clock time, and
 * in particular `"endOfDay"` is not local `23:59:59`: in a zone whose clocks
 * go back at midnight, `America/Santiago` on the day it leaves daylight
 * saving, that wall clock happens twice and the earlier of the two is an hour
 * before the day is over, so a filter bounded by it silently drops the last
 * hour of the day. `Temporal.PlainDate.toZonedDateTime(zone)` resolves the
 * first instant that exists on a local day, so a day with no local midnight
 * and a day that runs 23 or 25 hours both come out exact.
 *
 * The one second is the storage precision: canonical instants are whole
 * seconds, so one second before the next day begins is the last value that
 * can be stored on this one. A closed bound has to name a last moment, and
 * that is the cost of one; report handlers bounding a range have no such
 * constraint and should use the half-open `instants` pair
 * `resolveDateRangeQueryBounds` returns instead.
 *
 * Both edges are resolved in the zone the caller names — pass the same one the
 * display codecs are given, so a row that reads `2024-01-16 02:00` falls
 * inside a filter bounded by the 16th rather than the 15th.
 */
export type LocalDayBound = "startOfDay" | "endOfDay";

export function formatInstantForDateInput(
  value: unknown,
  zone: TimeZone,
): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    return localDayInZone(value, zone);
  } catch {
    return "";
  }
}

export function parseDateInputToInstantString(
  value: string,
  bound: LocalDayBound,
  zone: TimeZone,
): string | null {
  if (value === "") return null;
  const day = parsePlainDate(value);
  if (bound === "startOfDay") {
    return formatCanonicalInstant(day.toZonedDateTime(zone).toInstant());
  }
  return formatCanonicalInstant(
    day
      .add({ days: 1 })
      .toZonedDateTime(zone)
      .toInstant()
      .subtract({ seconds: 1 }),
  );
}

// ── Grouping by local day ────────────────────────────────────────────────

/**
 * The calendar day `instant` falls on in `zone`, as `YYYY-MM-DD`.
 *
 * A day, not text about a day: this is the body of the `to_tz_date` SQL
 * function the project database driver registers, so it runs once per row of a
 * grouped report, and it is what an `<input type="date">` is given as its
 * value. Both need exactly `YYYY-MM-DD`, which is why the shape is fixed here
 * rather than inherited from a display codec that is free to change.
 *
 * It reads the same wall clock `formatInstantForDisplay` reads, so the day a
 * report groups a row under is the day a grid cell shows for that row.
 *
 * It costs about 6µs a row, which is some thirty times SQLite's own
 * `date(col)` — a zone database is what that buys, and `date(col)` has none.
 * Six seconds a million rows is the number to hold in mind: bound the range in
 * the `WHERE` clause before grouping — that is what the `instants` pair from
 * `resolveDateRangeQueryBounds` is for — and this stays far below the cost of
 * the scan itself.
 *
 * Nothing is memoized. A per-zone day index would hold every day any report
 * ever scanned for the life of the process, to save an amount nobody has
 * needed yet. If a profile ever shows this dominating a report, add it then
 * and put the measurement next to it.
 *
 * Parsing is Temporal's, not `Date.parse`'s, which accepts `2024-02-30` and
 * answers March 1: a corrupt stored value fails the query rather than landing
 * in a silently wrong bucket.
 */
export function localDayInZone(instant: string, zone: TimeZone): string {
  return formatPlainDate(wallClockIn(instant, zone).toPlainDate());
}
