import { uiClient } from "../../platform/client";
import type { LookupResponse } from "@sapporta/shared/contracts";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupSearchPage } from "@sapporta/grid/lookup";

export function buildLookupValueQuery(values: readonly LookupValue[]): {
  ids?: string;
} {
  const ids = values.map((value) => String(value)).join(",");
  return ids ? { ids } : {};
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
): Promise<LookupResponse> {
  return uiClient.lookup({
    params: { tableName },
    query: {
      q: searchText,
      ...(limit === undefined ? {} : { limit: String(limit) }),
    },
  });
}

export function lookupEntriesFromResponse(
  response: LookupResponse,
): LookupEntry[] {
  return response.entries;
}

export async function fetchLookupEntriesForValues(
  tableName: string,
  values: readonly LookupValue[],
): Promise<LookupEntry[]> {
  if (values.length === 0) return [];
  const response = await fetchLookup(tableName, values);
  return lookupEntriesFromResponse(response);
}

export async function fetchLookupEntriesForSearch(args: {
  tableName: string;
  searchText: string;
  limit: number;
}): Promise<LookupSearchPage> {
  const response = await fetchLookupSearch(
    args.tableName,
    args.searchText,
    args.limit,
  );
  return {
    entries: lookupEntriesFromResponse(response),
  };
}
