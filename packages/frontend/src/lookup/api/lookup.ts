import { uiClient } from "@/platform/client";
import type { LookupResponse } from "@sapporta/shared/contracts";
import type { RowId } from "@sapporta/shared/row-id";
import type { LookupEntry } from "@sapporta/grid/lookup";
import type { LookupSearchPage } from "@sapporta/grid/lookup";

export async function fetchLookup(
  tableName: string,
  ids: RowId[],
): Promise<LookupResponse> {
  if (ids.length === 0) return { data: {} };
  return uiClient.lookup({
    params: { tableName },
    query: { ids: ids.join(",") },
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
): LookupEntry<string>[] {
  return Object.entries(response.data).map(([value, label]) => ({
    value,
    label,
  }));
}

export async function fetchLookupEntriesForValues(
  tableName: string,
  values: readonly unknown[],
): Promise<LookupEntry<string>[]> {
  const ids = values
    .map((value) => (value == null || value === "" ? null : String(value)))
    .filter((value): value is string => value != null);
  if (ids.length === 0) return [];
  const response = await fetchLookup(tableName, ids as RowId[]);
  return lookupEntriesFromResponse(response);
}

export async function fetchLookupEntriesForSearch(args: {
  tableName: string;
  searchText: string;
  limit: number;
}): Promise<LookupSearchPage<string>> {
  const response = await fetchLookupSearch(
    args.tableName,
    args.searchText,
    args.limit,
  );
  return {
    entries: lookupEntriesFromResponse(response),
  };
}
