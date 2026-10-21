import { useEffect, useMemo } from "react";
import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { Row } from "@sapporta/shared/contracts";
import { connectRowDataStore, createLookupStore } from "./row-data";
import type { RowDataStore } from "./row-data";
import type { LookupNarrowing } from "./api/lookup";
import { useRowDisplays } from "./row-display";

/**
 * A row store for a component, such as a form page, that lives as long as
 * the component. It draws rows with the displays of the nearest
 * `RowDisplayProvider`.
 */
export function useLookupStore(): RowDataStore {
  const rowDisplays = useRowDisplays();
  const store = useMemo(
    () => createLookupStore({ rowDisplays }),
    [rowDisplays],
  );
  useEffect(() => {
    const disconnect = connectRowDataStore(store);
    return () => {
      disconnect();
      store.clear();
    };
  }, [store]);
  return store;
}

/**
 * Lookup capabilities for one table. Parameterize with the table's primary-key
 * type — `useTableLookup<number>("accounts")` — to match a `LookupPicker` of
 * the same type. The store is key-agnostic at runtime, so the parameter is an
 * assertion about the column, the same one `LookupPicker<number>` already asks
 * for. Left unparameterized, ids stay `string | number`.
 *
 * `narrowing` limits the choices the search offers, such as
 * `{ filter: [{ column: "account_type", op: "in", values: ["asset"] }] }`,
 * or `{ notUnder: accountId }` for an account's parent.
 */
export function useTableLookup<TValue extends LookupValue = LookupValue>(
  tableName: string,
  narrowing?: LookupNarrowing,
): LookupCapabilities<TValue, Row> {
  const lookup: LookupCapabilities<LookupValue, Row> = useLookupStore().table(
    tableName,
    narrowing,
  );
  return lookup as LookupCapabilities<TValue, Row>;
}
