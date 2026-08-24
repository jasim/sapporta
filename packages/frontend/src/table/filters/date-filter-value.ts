/**
 * The value a `<input type="date">` exchanges with a filter condition.
 *
 * A `date` column speaks calendar dates, so the control's text is the
 * condition's value unchanged. A `timestamp` column stores instants, so the
 * text names a local day and the operator says which edge of that day the
 * bound sits on:
 *
 *   on or after / before  →  the day's first instant
 *   after / on or before  →  the day's last instant
 *
 * "before the 16th" ends where the 16th begins, and "after the 16th" starts
 * where it ends, which is why each pair shares an edge.
 *
 * Both edges are resolved in the zone this page reads on, so a row that reads
 * `2026-08-24 02:00` falls inside a filter bounded by the 24th. That is the
 * same zone the cells are written in, and a different one from the UTC the
 * server compares in — display and filtering agree only because this boundary
 * converts before the value goes out.
 *
 * The zone is read here rather than taken as an argument. This module runs
 * only in a browser, where `appTimeZone()` is the single published answer for
 * the whole page, so a parameter could hold no other value and every call
 * site would be passing the same thing.
 */

import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { ScalarOp } from "@sapporta/shared/filter";
import {
  formatInstantForDateInput,
  parseDateInputToInstantString,
  type LocalDayBound,
} from "@sapporta/shared/temporal";
import { appTimeZone } from "../../platform/app-time-zone";
import { inferDisplayType } from "../model/column-types";

/** Whether the column stores instants rather than calendar dates. */
export function isInstantColumn(column: ColumnSchema): boolean {
  return inferDisplayType(column) === "timestamp";
}

/** Condition value -> the day the date control shows. */
export function dateInputValue(column: ColumnSchema, encoded: string): string {
  return isInstantColumn(column)
    ? formatInstantForDateInput(encoded, appTimeZone())
    : encoded;
}

/** The day the reader picked -> the value the condition carries. */
export function dateInputConditionValue(
  column: ColumnSchema,
  op: ScalarOp | undefined,
  day: string,
): string {
  if (day === "" || !isInstantColumn(column)) return day;
  return (
    parseDateInputToInstantString(day, localDayBound(op), appTimeZone()) ?? ""
  );
}

function localDayBound(op: ScalarOp | undefined): LocalDayBound {
  return op === "gt" || op === "lte" ? "endOfDay" : "startOfDay";
}
