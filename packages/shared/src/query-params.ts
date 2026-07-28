/**
 * Lossless object representation for URL query parameters.
 *
 * Singleton keys stay as strings. A repeated key is represented by an ordered
 * array of strings so converting through an object does not discard values.
 */
export type QueryParamValue = string | readonly string[];
export type QueryParamRecord = Record<string, QueryParamValue>;

/** Append one value without changing singleton keys into arrays prematurely. */
export function appendQueryParam(
  params: QueryParamRecord,
  key: string,
  value: string,
): void {
  const current = params[key];
  if (current === undefined) {
    params[key] = value;
    return;
  }
  params[key] =
    typeof current === "string" ? [current, value] : [...current, value];
}

/** Convert the lossless record back to the repeated-key URL wire format. */
export function queryParamRecordToSearchParams(
  query: Readonly<QueryParamRecord>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      params.append(key, value);
      continue;
    }
    for (const item of value) params.append(key, item);
  }
  return params;
}

export function isQueryParamRecord(value: unknown): value is QueryParamRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) =>
      typeof item === "string" ||
      (Array.isArray(item) &&
        item.every((arrayItem) => typeof arrayItem === "string")),
  );
}

export function hasRepeatedQueryParams(
  query: Readonly<QueryParamRecord>,
): boolean {
  return Object.values(query).some(Array.isArray);
}
