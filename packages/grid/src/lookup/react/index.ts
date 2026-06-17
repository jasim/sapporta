import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SearchLookup } from "../cache/search-lookup";
import type {
  LookupEntry,
  LookupValue,
  ValueLookup,
} from "../cache/value-lookup";

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
  values: readonly unknown[],
): Record<string, string> {
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
    const labels: Record<string, string> = {};
    for (const value of values) {
      const key = lookupValueKey(value);
      labels[key] = valueLookup?.entryForValue(value)?.label ?? key;
    }
    return labels;
  }, [snapshot, valueKey, valueLookup]);
}

export function useLookupOptions(args: {
  valueLookup: ValueLookup | undefined;
  searchLookup: SearchLookup | undefined;
  selectedValues: readonly unknown[];
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
        value: key,
        label: selectedLabels[key] ?? key,
      });
    }
    for (const entry of searchEntries) {
      byValue.set(lookupValueKey(entry.value), entry);
    }
    return Array.from(byValue.values());
  }, [args.selectedValues, searchEntries, selectedKey, selectedLabels]);
}

function lookupValuesKey(values: readonly unknown[]): string {
  return values.map(lookupValueKey).join("\u0000");
}

function lookupValueKey(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "";
}

function subscribeNoop(): void {}
