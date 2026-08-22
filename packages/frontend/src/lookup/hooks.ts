import { useEffect, useMemo } from "react";
import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { Row } from "@sapporta/shared/contracts";
import { createLookupStore, type LookupStore } from "./store";

export function useLookupStore(): LookupStore<Row> {
  const store = useMemo(() => createLookupStore(), []);
  useEffect(() => () => store.clear(), [store]);
  return store;
}

/**
 * Lookup capabilities for one table. Parameterize with the table's primary-key
 * type — `useTableLookup<number>("accounts")` — to match a `LookupPicker` of
 * the same type. The store is key-agnostic at runtime, so the parameter is an
 * assertion about the column, the same one `LookupPicker<number>` already asks
 * for. Left unparameterized, ids stay `string | number`.
 */
export function useTableLookup<TValue extends LookupValue = LookupValue>(
  tableName: string,
): LookupCapabilities<TValue, Row> {
  return useLookupStore().table(tableName) as LookupCapabilities<TValue, Row>;
}
