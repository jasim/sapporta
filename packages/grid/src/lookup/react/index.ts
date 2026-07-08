import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SearchLookup } from "../cache/search-lookup";
import type {
  LookupEntry,
  LookupValue,
  ValueLookup,
} from "../cache/value-lookup";
import { lookupValueKey } from "../cache/value-lookup";

const EMPTY_LOOKUP_ENTRIES: readonly LookupEntry[] = [];

export function useLookupSearchResults<
  TValue extends LookupValue = LookupValue,
>(
  searchLookup: SearchLookup<TValue> | undefined,
  searchText: string,
  limit: number,
): readonly LookupEntry<TValue>[] {
  useEffect(() => {
    if (!searchLookup) return;
    void searchLookup.loadSearchResults({ searchText, limit });
  }, [searchLookup, searchText, limit]);

  return useSyncExternalStore(
    (listener) =>
      searchLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop,
    () =>
      searchLookup?.cachedSearchResults({ searchText }) ??
      (EMPTY_LOOKUP_ENTRIES as readonly LookupEntry<TValue>[]),
  );
}

export function useLookupValueLabels(
  valueLookup: ValueLookup | undefined,
  values: readonly LookupValue[],
): { labelFor(value: LookupValue): string | null } {
  const valueKey = lookupValuesKey(values);

  useEffect(() => {
    if (!valueLookup) return;
    void valueLookup.loadMissingEntries(values);
  }, [valueLookup, valueKey]);

  const snapshot = useSyncExternalStore(
    (listener) =>
      valueLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop,
    () =>
      values
        .map(
          (value) =>
            `${lookupValueKey(value)}\u0000${
              valueLookup?.entryForValue(value)?.label ?? ""
            }`,
        )
        .join("\u0001"),
  );

  return useMemo(() => {
    void snapshot;
    return {
      labelFor(value: LookupValue): string | null {
        return valueLookup?.entryForValue(value)?.label ?? null;
      },
    };
  }, [snapshot, valueKey, valueLookup]);
}

export function useLookupOptions(args: {
  valueLookup: ValueLookup | undefined;
  searchLookup: SearchLookup | undefined;
  selectedValues: readonly LookupValue[];
  searchText: string;
  limit: number;
}): readonly LookupEntry[] {
  const searchEntries = useLookupSearchResults(
    args.searchLookup,
    args.searchText,
    args.limit,
  );
  const selectedLabels = useLookupValueLabels(
    args.valueLookup,
    args.selectedValues,
  );
  const selectedKey = lookupValuesKey(args.selectedValues);

  return useMemo(() => {
    const byValue = new Map<string, LookupEntry>();
    for (const value of args.selectedValues) {
      const key = lookupValueKey(value);
      byValue.set(key, {
        value,
        label: selectedLabels.labelFor(value) ?? String(value),
      });
    }
    for (const entry of searchEntries) {
      byValue.set(lookupValueKey(entry.value), entry);
    }
    return Array.from(byValue.values());
  }, [args.selectedValues, searchEntries, selectedKey, selectedLabels]);
}

function lookupValuesKey(values: readonly LookupValue[]): string {
  return values.map(lookupValueKey).join("\u0000");
}

function subscribeNoop(): void {}
