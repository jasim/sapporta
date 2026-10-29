import { uiClient } from "../../platform/client";
import type {
  LookupResponse,
  LookupTreeResponse,
  Row,
} from "@sapporta/shared/contracts";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupSearchPage } from "@sapporta/grid/lookup";
import {
  encodeFilters,
  type FilterDraftCondition,
} from "@sapporta/shared/filter";
import { appendQueryParam, type QueryParamRecord } from "@sapporta/shared";

/**
 * Narrows a lookup's choices. Lookups by id are never narrowed, so a chosen
 * row keeps its label after it stops matching.
 */
export type LookupNarrowing = {
  /** Conditions in the list filter grammar, such as accounts of one type. */
  filter?: readonly FilterDraftCondition[];
  /** Leaves out this row of a tree table and the rows below it, such as when
   *  choosing a row's parent. */
  notUnder?: LookupValue;
};

/** The query parameters of a narrowing. */
export function lookupNarrowingQuery(
  narrowing: LookupNarrowing | undefined,
): QueryParamRecord {
  const query: QueryParamRecord = {};
  for (const [key, value] of encodeFilters(narrowing?.filter ?? [])) {
    appendQueryParam(query, key, value);
  }
  if (narrowing?.notUnder !== undefined) {
    query.notUnder = String(narrowing.notUnder);
  }
  return query;
}

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
  narrowing?: LookupNarrowing,
): Promise<LookupResponse> {
  return uiClient.lookup({
    params: { tableName },
    query: {
      ...lookupNarrowingQuery(narrowing),
      ...buildLookupSearchQuery(searchText, limit, fields, computed),
    },
  });
}

/** Every row of a tree table that the narrowing lets through, with the
 *  ancestors that place it, in tree order. */
export async function fetchLookupTree(
  tableName: string,
  computed?: readonly string[],
  narrowing?: LookupNarrowing,
): Promise<LookupTreeResponse> {
  return uiClient.lookupTree({
    params: { tableName },
    query: { ...lookupNarrowingQuery(narrowing), ...computedQuery(computed) },
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
