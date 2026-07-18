import {
  CachedSearchLookup,
  CachedValueLookup,
  type LookupValue,
  type SearchLookup,
  type ValueLookup,
} from "@sapporta/grid/lookup";
import type { Row } from "@sapporta/shared/contracts";
import {
  fetchLookupEntriesForSearch,
  fetchLookupEntriesForValues,
} from "./api/lookup";

export type TableLookupSource = {
  valueLookup: ValueLookup<LookupValue, Row>;
  searchLookup: SearchLookup<LookupValue, Row>;
};

export function createTableLookupSource(tableName: string): TableLookupSource {
  return {
    valueLookup: new CachedValueLookup<LookupValue, Row>({
      loadEntriesForValues: (values) =>
        fetchLookupEntriesForValues(tableName, values),
    }),
    searchLookup: new CachedSearchLookup<LookupValue, Row>({
      loadEntriesForSearch: ({ searchText, limit, fields }) =>
        fetchLookupEntriesForSearch({
          tableName,
          searchText,
          limit,
          fields,
        }),
    }),
  };
}
