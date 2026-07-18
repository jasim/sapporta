import { useEffect, useMemo } from "react";
import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { Row } from "@sapporta/shared/contracts";
import { createLookupStore, type LookupStore } from "./store";

export function useLookupStore(): LookupStore<Row> {
  const store = useMemo(() => createLookupStore(), []);
  useEffect(() => () => store.clear(), [store]);
  return store;
}

export function useTableLookup(
  tableName: string,
): LookupCapabilities<LookupValue, Row> {
  return useLookupStore().table(tableName);
}
