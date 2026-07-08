import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import { CachedSearchLookup, type SearchLookup } from "@sapporta/grid/lookup";
import { CachedValueLookup, type ValueLookup } from "@sapporta/grid/lookup";
import {
  fetchLookupEntriesForSearch,
  fetchLookupEntriesForValues,
} from "../../lookup/api/lookup";

export type TableLookupKey = `${string}.${string}->${string}.${string}`;

export type TableForeignKeyLookupBundle = {
  key: TableLookupKey;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  valueLookup: ValueLookup;
  searchLookup: SearchLookup;
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

      const valueLookup = new CachedValueLookup({
        loadEntriesForValues: (values) =>
          fetchLookupEntriesForValues(targetTable, values),
      });
      const searchLookup = new CachedSearchLookup({
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
