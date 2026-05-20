import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import {
  CachedSearchLookup,
  type SearchLookup,
} from "@/lookup/cache/search-lookup";
import {
  CachedValueLookup,
  type ValueLookup,
} from "@/lookup/cache/value-lookup";
import {
  fetchLookupEntriesForSearch,
  fetchLookupEntriesForValues,
} from "@/lookup/api/lookup";

export type TableLookupKey = `${string}.${string}->${string}.${string}`;

export type TableForeignKeyLookupBundle = {
  key: TableLookupKey;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  valueLookup: ValueLookup<string>;
  searchLookup: SearchLookup<string>;
};

export type TableLookupRegistry = {
  bundleFor(args: {
    sourceTable: string;
    column: TableColumnSchema;
  }): TableForeignKeyLookupBundle | undefined;
  dispose(): void;
};

export function createTableLookupRegistry(): TableLookupRegistry {
  const bundles = new Map<TableLookupKey, TableForeignKeyLookupBundle>();

  return {
    bundleFor({ sourceTable, column }) {
      if (!column.foreignKey) return undefined;

      const { table: targetTable, column: targetColumn } = column.foreignKey;
      const key =
        `${sourceTable}.${column.name}->${targetTable}.${targetColumn}` as TableLookupKey;
      const existing = bundles.get(key);
      if (existing) return existing;

      const valueLookup = new CachedValueLookup<string>({
        loadEntriesForValues: (values) =>
          fetchLookupEntriesForValues(targetTable, values),
      });
      const searchLookup = new CachedSearchLookup<string>({
        loadEntriesForSearch: ({ searchText, limit }) =>
          fetchLookupEntriesForSearch({
            tableName: targetTable,
            searchText,
            limit,
          }),
      });
      const bundle: TableForeignKeyLookupBundle = {
        key,
        sourceTable,
        sourceColumn: column.name,
        targetTable,
        targetColumn,
        valueLookup,
        searchLookup,
      };
      bundles.set(key, bundle);
      return bundle;
    },
    dispose() {
      for (const bundle of bundles.values()) {
        bundle.valueLookup.dispose?.();
        bundle.searchLookup.dispose?.();
      }
      bundles.clear();
    },
  };
}
