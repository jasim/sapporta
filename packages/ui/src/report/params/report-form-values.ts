/**
 * Report param form values — the report UI's typed interior model.
 *
 * The route/URL layer speaks flat string params; the daterange control speaks
 * `DateRangeState`. This module is the single codec between those two shapes.
 */

import {
  allTime,
  serializeDateRange,
  snapshotDateRange,
  Temporal,
  type DateRangeState,
} from "@sapporta/shared";
import type { ReportParam } from "@sapporta/shared/contracts";
import { parseDateRangeLenient } from "./daterange-picker";
export type FlatReportParams = Record<string, string>;
export type ReportFormValue = string | DateRangeState;
export type ReportFormValues = Record<string, ReportFormValue>;

export function inflateReportFormValues(
  params: ReportParam[],
  flatValues: FlatReportParams,
): ReportFormValues {
  const values: ReportFormValues = {};

  for (const param of params) {
    values[param.name] =
      param.type === "daterange"
        ? parseDateRangeLenient(param.name, flatValues)
        : flatValues[param.name] ?? "";
  }

  return values;
}

export function serializeReportFormValues(
  params: ReportParam[],
  values: ReportFormValues,
): FlatReportParams {
  const flatValues: FlatReportParams = {};

  for (const param of params) {
    if (param.type === "daterange") {
      Object.assign(
        flatValues,
        serializeDateRange(readDateRangeReportFormValue(values[param.name]), param.name),
      );
      continue;
    }

    const value = readScalarReportFormValue(values[param.name]);
    if (value) flatValues[param.name] = value;
  }

  return flatValues;
}

export function buildExecuteReportParams(
  params: ReportParam[],
  values: ReportFormValues,
): Record<string, string | number> {
  const executeParams: Record<string, string | number> = {};

  for (const param of params) {
    if (param.type === "daterange") {
      Object.assign(
        executeParams,
        serializeDateRange(readDateRangeReportFormValue(values[param.name]), param.name),
      );
      continue;
    }

    const value = readScalarReportFormValue(values[param.name]);
    if (!value) continue;

    switch (param.type) {
      case "integer":
        executeParams[param.name] = parseInt(value, 10);
        break;
      case "float":
        executeParams[param.name] = parseFloat(value);
        break;
      default:
        executeParams[param.name] = value;
        break;
    }
  }

  return executeParams;
}

export function hasRelativeDateRangeInFormValues(
  params: ReportParam[],
  values: ReportFormValues,
): boolean {
  return params.some(
    (param) =>
      param.type === "daterange" &&
      readDateRangeReportFormValue(values[param.name]).type === "relative",
  );
}

export function snapshotReportFormValues(
  params: ReportParam[],
  values: ReportFormValues,
  today: Temporal.PlainDate,
): FlatReportParams {
  const snapshotValues: FlatReportParams = {};

  for (const param of params) {
    if (param.type === "daterange") {
      const state = readDateRangeReportFormValue(values[param.name]);
      const frozenState =
        state.type === "relative" ? snapshotDateRange(state, today) : state;
      Object.assign(snapshotValues, serializeDateRange(frozenState, param.name));
      continue;
    }

    const value = readScalarReportFormValue(values[param.name]);
    if (value) snapshotValues[param.name] = value;
  }

  return snapshotValues;
}

export function readScalarReportFormValue(
  value: ReportFormValue | undefined,
): string {
  return typeof value === "string" ? value : "";
}

export function readDateRangeReportFormValue(
  value: ReportFormValue | undefined,
): DateRangeState {
  return isDateRangeState(value) ? value : allTime();
}

export function flatReportParamsEqual(
  left: FlatReportParams,
  right: FlatReportParams,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }

  return true;
}

function isDateRangeState(
  value: ReportFormValue | undefined,
): value is DateRangeState {
  return typeof value === "object" && value !== null && "type" in value;
}
