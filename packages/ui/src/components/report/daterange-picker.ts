import {
  allTime,
  custom,
  parseDateRange,
  parsePlainDate,
  relative,
  type DateRangeSelectKey,
  type DateRangeState,
  type Temporal,
} from "@sapporta/shared";

export function selectKeyFromState(state: DateRangeState): DateRangeSelectKey {
  switch (state.type) {
    case "all_time":
      return "all_time";
    case "custom":
      return "custom";
    case "relative":
      return state.duration;
  }
}

/**
 * Given the prior state and a newly-chosen key, compute the next state.
 * Re-selecting "custom" while already in custom mode preserves in-flight
 * bounds; otherwise entering custom mode starts unbounded on both sides.
 */
export function stateFromSelectKey(
  key: DateRangeSelectKey,
  prior: DateRangeState,
): DateRangeState {
  if (key === "all_time") return allTime();
  if (key === "custom") {
    return prior.type === "custom" ? prior : custom(null, null);
  }
  return relative(key);
}

/**
 * Parse report URL params for UI display. The server path remains strict;
 * this read-side helper keeps the report form renderable for malformed or
 * outdated URLs.
 */
export function parseDateRangeLenient(
  paramName: string,
  params: Record<string, unknown>,
): DateRangeState {
  try {
    return parseDateRange(paramName, params);
  } catch {
    return allTime();
  }
}

/**
 * Update one bound of a custom range. Empty strings clear the bound to
 * unbounded; malformed dates leave the prior state untouched.
 */
export function updateCustomBound(
  state: DateRangeState,
  side: "start" | "end",
  dateStr: string,
): DateRangeState {
  if (state.type !== "custom") return state;

  let parsed: Temporal.PlainDate | null = null;
  if (dateStr) {
    try {
      parsed = parsePlainDate(dateStr);
    } catch {
      return state;
    }
  }

  return side === "start"
    ? custom(parsed, state.end)
    : custom(state.start, parsed);
}

export function customBoundString(
  state: DateRangeState,
  side: "start" | "end",
): string {
  if (state.type !== "custom") return "";
  const date = side === "start" ? state.start : state.end;
  return date ? date.toString() : "";
}
