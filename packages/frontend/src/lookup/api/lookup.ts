import { uiClient } from "../../platform/client";
import type { LookupResponse, Row } from "@sapporta/shared/contracts";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupSearchPage } from "@sapporta/grid/lookup";

export function buildLookupValueQuery(values: readonly LookupValue[]): {
  ids?: string;
} {
  const ids = values.map((value) => String(value)).join(",");
  return ids ? { ids } : {};
}

export function buildLookupSearchQuery(
  searchText: string,
  limit?: number,
  fields?: readonly string[],
): { q: string; limit?: string; fields?: string } {
  const displayedFields = Array.from(new Set(fields ?? []));
  return {
    q: searchText,
    ...(limit === undefined ? {} : { limit: String(limit) }),
    ...(displayedFields.length === 0
      ? {}
      : { fields: displayedFields.join(",") }),
  };
}

export async function fetchLookup(
  tableName: string,
  ids: readonly LookupValue[],
): Promise<LookupResponse> {
  if (ids.length === 0) return { entries: [] };
  return uiClient.lookup({
    params: { tableName },
    query: buildLookupValueQuery(ids),
  });
}

export async function fetchLookupSearch(
  tableName: string,
  searchText: string,
  limit?: number,
  fields?: readonly string[],
): Promise<LookupResponse> {
  return uiClient.lookup({
    params: { tableName },
    query: buildLookupSearchQuery(searchText, limit, fields),
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
