import { RELATIVE_DURATIONS, type RelativeDuration } from "./daterange.js";

// ---------------------------------------------------------------------------
// Daterange picker key space
// ---------------------------------------------------------------------------
//
// The picker collapses the three-arm union into one flat key space so a
// single searchable choice control can drive the whole control. `custom` names
// the *mode* — the concrete start/end live alongside it in the state.

export type DateRangeSelectKey = "all_time" | RelativeDuration | "custom";

/** All keys in display order. Labels are UI and live in the component. */
export const DATE_RANGE_SELECT_KEYS: readonly DateRangeSelectKey[] = [
  "all_time",
  ...RELATIVE_DURATIONS,
  "custom",
];
