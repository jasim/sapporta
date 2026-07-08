import { useEffect, useMemo } from "react";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import { createLookupStore, type LookupStore } from "./store";

export function useLookupStore(): LookupStore {
  const store = useMemo(() => createLookupStore(), []);
  useEffect(() => () => store.clear(), [store]);
  return store;
}

export function useTableLookup(tableName: string): LookupCapabilities {
  return useLookupStore().table(tableName);
}
