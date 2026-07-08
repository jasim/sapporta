import {
  CachedSearchLookup,
  CachedValueLookup,
  type SearchLookup,
  type ValueLookup,
} from "@sapporta/grid/lookup";
import {
  fetchLookupEntriesForSearch,
  fetchLookupEntriesForValues,
} from "./api/lookup";

export type TableLookupSource = {
  valueLookup: ValueLookup;
  searchLookup: SearchLookup;
};

export function createTableLookupSource(tableName: string): TableLookupSource {
  return {
    valueLookup: new CachedValueLookup({
      loadEntriesForValues: (values) =>
        fetchLookupEntriesForValues(tableName, values),
    }),
    searchLookup: new CachedSearchLookup({
      loadEntriesForSearch: ({ searchText, limit }) =>
        fetchLookupEntriesForSearch({
          tableName,
          searchText,
          limit,
        }),
    }),
  };
}
