import { useEffect, useMemo } from "react";
import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { Row } from "@sapporta/shared/contracts";
import { createLookupStore } from "./row-data";
import type { RowDataStore } from "./row-data";
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
  const lookup: LookupCapabilities<LookupValue, Row> =
    useLookupStore().table(tableName);
  return lookup as LookupCapabilities<TValue, Row>;
}
