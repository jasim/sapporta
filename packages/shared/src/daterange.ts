/**
 * Daterange — a discriminated-union value type for "pick a time window".
 *
 * Shared across engine, UI, and wire format. The union models three
 * mutually-exclusive states the user can be in (all time, rolling
 * relative window, absolute custom window) so the application cannot
 * get into a hybrid "partial custom while relative is active" state.
 *
 * The engine flattens the state to a concrete {from, to} pair at the
 * SQL boundary via `resolveDateRange`; the richer state is preserved
 * through every other layer (URL, form, HTTP payload) so that a
 * user's "Last 30 days" choice stays semantically that — not a frozen
 * pair of dates that would silently age.
 *
 * The state a reader picks is date-granular either way; what differs is
 * the column it is compared against, so `resolveDateRangeQueryBounds`
 * resolves it once into both shapes — inclusive calendar days for a `date`
 * column, and the half-open window of UTC instants those days occupy for a
 * `timestamp` column. It takes the workspace time zone, because a calendar
 * day is only a range of instants once a zone says which one.
 */

import {
  Temporal,
  formatCanonicalInstant,
  formatPlainDate,
  parsePlainDate,
  type TimeZone,
} from "./temporal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rolling-window presets. Each is evaluated against "today" at request
 *  time. `mtd`/`ytd` anchor to the start of the current month/year. */
export const RELATIVE_DURATIONS = [
  "7d",
  "30d",
  "90d",
  "1y",
  "mtd",
  "ytd",
] as const;
export type RelativeDuration = (typeof RELATIVE_DURATIONS)[number];

export function isRelativeDuration(s: string): s is RelativeDuration {
  return (RELATIVE_DURATIONS as readonly string[]).includes(s);
}

/** Discriminated union. `custom` bounds are independently nullable;
 *  null on either side means "unbounded on that side". */
export type DateRangeState =
  | { type: "all_time" }
  | { type: "relative"; duration: RelativeDuration }
  | {
      type: "custom";
      start: Temporal.PlainDate | null;
      end: Temporal.PlainDate | null;
    };

/** Flattened boundary pair the engine passes to SQL. `null` on either
 *  side means the bound is omitted; route-based report screens can use the
 *  `$x IS NULL OR col >= $x` idiom to honor that. */
export type ResolvedDateRange = {
  from: Temporal.PlainDate | null;
  to: Temporal.PlainDate | null;
};

/**
 * The days a reader named, in both of the shapes a column can be compared
 * against. `null` on either side means the bound is open there.
 *
 * Both come from one resolution of the same days, so they cannot drift; the
 * call site picks the pair that matches its column, and that choice is
 * visible at the comparison rather than three lines away at the call that
 * produced it.
 *
 * `days` are inclusive calendar dates, which is what a `date` column wants: a
 * stored `"2026-08-24"` compares equal to a bound of `"2026-08-24"`.
 *
 * `instants` are the half-open window of UTC those days occupy, which is what
 * a `timestamp` column wants. The upper bound is named `until` rather than
 * `to` so that a call site cannot mistake it for an inclusive bound and write
 * `<=`.
 */
export type DateRangeQueryBounds = {
  state: DateRangeState;
  days: { from: string | null; to: string | null };
  instants: { from: string | null; until: string | null };
};

// ---------------------------------------------------------------------------
// Constructors / state transitions
// ---------------------------------------------------------------------------

export const allTime = (): DateRangeState => ({ type: "all_time" });

export const relative = (duration: RelativeDuration): DateRangeState => ({
  type: "relative",
  duration,
});

export const custom = (
  start: Temporal.PlainDate | null,
  end: Temporal.PlainDate | null,
): DateRangeState => ({ type: "custom", start, end });

// ---------------------------------------------------------------------------
// Resolution — state → SQL-bindable boundary pair
// ---------------------------------------------------------------------------

/**
 * Collapse a `DateRangeState` to the two boundary dates the engine
 * binds into SQL. `today` is injected so tests are deterministic and
 * so the caller (engine) controls the wall-clock reference.
 */
export function resolveDateRange(
  state: DateRangeState,
  today: Temporal.PlainDate,
): ResolvedDateRange {
  switch (state.type) {
    case "all_time":
      return { from: null, to: null };

    case "custom":
      return { from: state.start, to: state.end };

    case "relative":
      return resolveRelative(state.duration, today);
  }
}

function resolveRelative(
  d: RelativeDuration,
  today: Temporal.PlainDate,
): ResolvedDateRange {
  switch (d) {
    case "7d":
      return { from: today.subtract({ days: 7 }), to: today };
    case "30d":
      return { from: today.subtract({ days: 30 }), to: today };
    case "90d":
      return { from: today.subtract({ days: 90 }), to: today };
    case "1y":
      return { from: today.subtract({ years: 1 }), to: today };
    case "mtd":
      return { from: today.with({ day: 1 }), to: today };
    case "ytd":
      return { from: today.with({ month: 1, day: 1 }), to: today };
  }
}

// ---------------------------------------------------------------------------
// Wire format — flat URL parameters
// ---------------------------------------------------------------------------
//
// A daterange param named `P` occupies up to three URL keys:
//
//   P_relative=<duration>   (e.g. P_relative=30d, P_relative=ytd)
//   P_from=<yyyy-mm-dd>
//   P_to=<yyyy-mm-dd>
//
// Exactly one of two modes is active at a time:
//   - `P_relative` present            → relative
//   - `P_from` and/or `P_to` present  → custom (missing side = open)
//   - none present                    → all_time
//
// Supplying `P_relative` alongside `P_from`/`P_to` is rejected rather
// than silently ambiguated — the modes are mutually exclusive.
//
// Relative tokens stay relative — loading the URL tomorrow re-evaluates
// against tomorrow's "today". `snapshotDateRange` freezes a relative
// range into its custom equivalent at click time.

export class DateRangeParseError extends Error {
  constructor(
    message: string,
    public readonly context: unknown,
  ) {
    super(`${message}: ${JSON.stringify(context)}`);
    this.name = "DateRangeParseError";
  }
}

/** URL keys that carry a daterange param named `paramName`. Centralised
 *  so the naming convention lives in one place. */
export function dateRangeFieldNames(paramName: string): {
  relative: string;
  from: string;
  to: string;
} {
  return {
    relative: `${paramName}_relative`,
    from: `${paramName}_from`,
    to: `${paramName}_to`,
  };
}

/**
 * Serialize a state into the flat URL-key shape. Keys that would be
 * empty are omitted — callers merge the returned record into a
 * URLSearchParams or form-values map.
 */
export function serializeDateRange(
  state: DateRangeState,
  paramName: string,
): Record<string, string> {
  const names = dateRangeFieldNames(paramName);
  switch (state.type) {
    case "all_time":
      return {};
    case "relative":
      return { [names.relative]: state.duration };
    case "custom": {
      const out: Record<string, string> = {};
      if (state.start) out[names.from] = formatPlainDate(state.start);
      if (state.end) out[names.to] = formatPlainDate(state.end);
      return out;
    }
  }
}

/**
 * Read the (up to three) URL keys for `paramName` out of a flat
 * params map and return the corresponding state. Throws
 * `DateRangeParseError` on malformed or conflicting input; returns
 * `all_time` when every key is absent.
 */
export function parseDateRange(
  paramName: string,
  params: Record<string, unknown>,
): DateRangeState {
  const names = dateRangeFieldNames(paramName);
  const rel = stringOrEmpty(params[names.relative]);
  const from = stringOrEmpty(params[names.from]);
  const to = stringOrEmpty(params[names.to]);

  if (rel && (from || to)) {
    throw new DateRangeParseError(
      `daterange "${paramName}": cannot combine ${names.relative} with ${names.from}/${names.to}`,
      { [names.relative]: rel, [names.from]: from, [names.to]: to },
    );
  }

  if (rel) {
    if (!isRelativeDuration(rel)) {
      throw new DateRangeParseError(
        `unknown relative duration "${rel}" for param "${paramName}"`,
        { [names.relative]: rel },
      );
    }
    return relative(rel);
  }

  if (from || to) {
    return custom(
      from ? safeParsePlainDate(from, names.from) : null,
      to ? safeParsePlainDate(to, names.to) : null,
    );
  }

  return allTime();
}

/**
 * Parse a route query's daterange fields and resolve the days a reader named.
 *
 * The result carries both shapes a column can be compared against — inclusive
 * calendar days for a `date` column, and the half-open window of UTC instants
 * those days occupy for a `timestamp` column:
 *
 *   const zone = workspaceTimeZone(c.get("auth"));
 *   const period = resolveDateRangeQueryBounds(
 *     "period", request.query, zone, Temporal.Now.instant(),
 *   );
 *
 *   WHERE (:from  IS NULL OR issued_on  >= :from)     -- period.days
 *     AND (:to    IS NULL OR issued_on  <= :to)
 *
 *   WHERE (:from  IS NULL OR created_at >= :from)     -- period.instants
 *     AND (:until IS NULL OR created_at <  :until)
 *
 * One function rather than one per column type, because the two differ only in
 * what they are compared against and a caller who picked the wrong one would
 * get a report that silently drops a day: every instant stored on the 24th
 * begins `"2026-08-24T"`, which sorts after an inclusive bound of
 * `"2026-08-24"`.
 *
 * The instant window is half-open for two reasons. A closed upper bound has to
 * name the last representable moment, which writes the storage precision
 * (whole seconds) into every call site, so a later move to sub-second
 * precision would make every closed bound wrong by up to a second. And a
 * closed bound built from a wall-clock time such as `23:59:59` loses an hour
 * on the day a zone leaves daylight saving, because that wall clock occurs
 * twice and the earlier of the two is an hour before the day ends. The
 * half-open form is `[start of day N, start of day N+1)` and needs no special
 * case for either. Both edges come from
 * `Temporal.PlainDate.toZonedDateTime(zone)`, which returns the first instant
 * that exists on a local day, so the window is exact on a day whose local
 * midnight does not exist and on a day that runs 23 or 25 hours.
 *
 * `zone` and `now` are both required and neither has a default. Resolving
 * `7d` or `mtd` means knowing what day it is, and that question has no
 * zone-free answer: a defaulted `today` would read the host's `TZ`, so the
 * same report would return different rows depending on how the container was
 * started. Tests pass a fixed instant.
 */
export function resolveDateRangeQueryBounds(
  paramName: string,
  params: Record<string, unknown>,
  zone: TimeZone,
  now: Temporal.Instant,
): DateRangeQueryBounds {
  const state = parseDateRange(paramName, params);
  const { from, to } = resolveDateRange(state, todayIn(zone, now));
  return {
    state,
    days: {
      from: from ? formatPlainDate(from) : null,
      to: to ? formatPlainDate(to) : null,
    },
    instants: {
      from: from ? startOfDayInstant(from, zone) : null,
      until: to ? startOfDayInstant(to.add({ days: 1 }), zone) : null,
    },
  };
}

/** The calendar day `now` falls on in `zone`. */
function todayIn(zone: TimeZone, now: Temporal.Instant): Temporal.PlainDate {
  return now.toZonedDateTimeISO(zone).toPlainDate();
}

/** The first instant of `date` in `zone`, in canonical storage form. */
function startOfDayInstant(date: Temporal.PlainDate, zone: TimeZone): string {
  return formatCanonicalInstant(date.toZonedDateTime(zone).toInstant());
}

function stringOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  throw new DateRangeParseError(
    `daterange field must be a string, got ${typeof v}`,
    v,
  );
}

function safeParsePlainDate(s: string, field: string): Temporal.PlainDate {
  try {
    return parsePlainDate(s);
  } catch {
    throw new DateRangeParseError(`invalid date for "${field}"`, s);
  }
}

// ---------------------------------------------------------------------------
// Snapshot — freeze a relative range into a custom one
// ---------------------------------------------------------------------------

/**
 * Resolve a relative range to its equivalent custom range. `all_time`
 * and `custom` states are returned unchanged — there is nothing to
 * freeze.
 *
 * Used by the "Copy snapshot link" UI action so that a pasted link
 * stays semantically stable over time.
 */
export function snapshotDateRange(
  state: DateRangeState,
  today: Temporal.PlainDate,
): DateRangeState {
  if (state.type !== "relative") return state;
  const { from, to } = resolveDateRange(state, today);
  return custom(from, to);
}
