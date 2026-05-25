import { dateRangeFieldNames } from "@sapporta/shared";
import type { ReportParam } from "@sapporta/shared/contracts";

export function buildReportSearchParams(
  values: Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) {
    if (val) {
      params.set(key, val);
    }
  }
  return params;
}

/**
 * Report URLs stay in the flat wire shape. Dateranges therefore read/write the
 * three companion keys (`<name>_relative`, `<name>_from`, `<name>_to`) rather
 * than a nested object.
 */
export function parseReportSearchParams(
  searchParams: URLSearchParams,
  params: ReportParam[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const param of params) {
    if (param.type === "daterange") {
      const names = dateRangeFieldNames(param.name);
      for (const key of [names.relative, names.from, names.to]) {
        const value = searchParams.get(key);
        if (value !== null) result[key] = value;
      }
      continue;
    }

    const value = searchParams.get(param.name);
    if (value !== null) result[param.name] = value;
  }

  return result;
}

/** URL for a report view with pre-populated params. */
export function reportUrlWithParams(
  reportName: string,
  values: Record<string, string>,
): string {
  const params = buildReportSearchParams(values);
  return `/reports/${reportName}?${params.toString()}`;
}
