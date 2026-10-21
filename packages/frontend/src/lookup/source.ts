import {
  CachedSearchLookup,
  CachedValueLookup,
  type LookupEntry,
  type LookupValue,
  type SearchLookup,
  type ValueLookup,
} from "@sapporta/grid/lookup";
import {
  MAX_LOOKUP_IDS,
  type ComputedValues,
  type Row,
} from "@sapporta/shared/contracts";
import { fetchLookup, fetchLookupSearch } from "./api/lookup";

export type TableLookupSource = {
  valueLookup: ValueLookup<LookupValue, Row>;
  searchLookup: SearchLookup<LookupValue, Row>;
};

/** A table lookup source whose caches can be read again after a write. */
export type CachedTableLookupSource = {
  valueLookup: CachedValueLookup<LookupValue, Row>;
  searchLookup: CachedSearchLookup<LookupValue, Row>;
};

/** What one lookup asks for beside its entries, and where it stores them. */
export type LookupComputedRequest = {
  fields: readonly string[];
  /** Receives the response's computed values, before its entries are stored. */
  store(values: ComputedValues): void;
};

export function createTableLookupSource(
  tableName: string,
  /** Called as each lookup is sent. */
  computed?: () => LookupComputedRequest,
): CachedTableLookupSource {
  return {
    valueLookup: new CachedValueLookup<LookupValue, Row>({
      loadEntriesForValues: async (values) => {
        // The server takes at most MAX_LOOKUP_IDS ids per lookup, and a
        // reload asks for every cached entry at once.
        const entries: LookupEntry<LookupValue, Row>[] = [];
        for (let start = 0; start < values.length; start += MAX_LOOKUP_IDS) {
          const request = computed?.();
          const response = await fetchLookup(
            tableName,
            values.slice(start, start + MAX_LOOKUP_IDS),
            request?.fields,
          );
          if (response.computed) request?.store(response.computed);
          entries.push(...response.entries);
        }
        return entries;
      },
    }),
    searchLookup: new CachedSearchLookup<LookupValue, Row>({
      loadEntriesForSearch: async ({ searchText, limit, fields }) => {
        const request = computed?.();
        const response = await fetchLookupSearch(
          tableName,
          searchText,
          limit,
          fields,
          request?.fields,
        );
        if (response.computed) request?.store(response.computed);
        return { entries: response.entries };
      },
    }),
  };
}
