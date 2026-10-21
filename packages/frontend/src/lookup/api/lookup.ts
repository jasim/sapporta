import { uiClient } from "../../platform/client";
import type { LookupResponse, Row } from "@sapporta/shared/contracts";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupSearchPage } from "@sapporta/grid/lookup";

export function buildLookupValueQuery(
  values: readonly LookupValue[],
  computed?: readonly string[],
): {
  ids: string;
  computed?: string;
} {
  if (values.length === 0) {
    throw new RangeError("A value lookup requires at least one ID.");
  }
  const ids = values.map((value) => String(value)).join(",");
  return { ids, ...computedQuery(computed) };
}

export function buildLookupSearchQuery(
  searchText: string,
  limit?: number,
  fields?: readonly string[],
  computed?: readonly string[],
): { q: string; limit?: string; fields?: string; computed?: string } {
  const displayedFields = Array.from(new Set(fields ?? []));
  return {
    q: searchText,
    ...(limit === undefined ? {} : { limit: String(limit) }),
    ...(displayedFields.length === 0
      ? {}
      : { fields: displayedFields.join(",") }),
    ...computedQuery(computed),
  };
}

/** The `computed` query parameter, or nothing when no field is named. */
export function computedQuery(computed: readonly string[] | undefined): {
  computed?: string;
} {
  const names = Array.from(new Set(computed ?? []));
  return names.length === 0 ? {} : { computed: names.join(",") };
}

export async function fetchLookup(
  tableName: string,
  ids: readonly LookupValue[],
  computed?: readonly string[],
): Promise<LookupResponse> {
  if (ids.length === 0) return { entries: [] };
  return uiClient.lookup({
    params: { tableName },
    query: buildLookupValueQuery(ids, computed),
  });
}

export async function fetchLookupSearch(
  tableName: string,
  searchText: string,
  limit?: number,
  fields?: readonly string[],
  computed?: readonly string[],
): Promise<LookupResponse> {
  return uiClient.lookup({
    params: { tableName },
    query: buildLookupSearchQuery(searchText, limit, fields, computed),
  });
}

export function lookupEntriesFromResponse(
  response: LookupResponse,
): LookupEntry<LookupValue, Row>[] {
  return response.entries;
}

export async function fetchLookupEntriesForValues(
  tableName: string,
  values: readonly LookupValue[],
): Promise<LookupEntry<LookupValue, Row>[]> {
  if (values.length === 0) return [];
  const response = await fetchLookup(tableName, values);
  return lookupEntriesFromResponse(response);
}

export async function fetchLookupEntriesForSearch(args: {
  tableName: string;
  searchText: string;
  limit: number;
  fields?: readonly string[];
}): Promise<LookupSearchPage<LookupValue, Row>> {
  const response = await fetchLookupSearch(
    args.tableName,
    args.searchText,
    args.limit,
    args.fields,
  );
  return {
    entries: lookupEntriesFromResponse(response),
  };
}
