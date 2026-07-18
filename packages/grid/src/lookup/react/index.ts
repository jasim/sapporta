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
  TMeta = unknown,
>(
  searchLookup: SearchLookup<TValue, TMeta> | undefined,
  searchText: string,
  limit: number,
  fields?: readonly string[],
): readonly LookupEntry<TValue, TMeta>[] {
  const fieldsKey = lookupFieldsKey(fields);

  useEffect(() => {
    if (!searchLookup) return;
    void searchLookup.loadSearchResults({ searchText, limit, fields });
  }, [searchLookup, searchText, limit, fieldsKey]);

  return useSyncExternalStore(
    (listener) =>
      searchLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop,
    () =>
      searchLookup?.cachedSearchResults({ searchText, fields }) ??
      (EMPTY_LOOKUP_ENTRIES as readonly LookupEntry<TValue, TMeta>[]),
  );
}

export function useLookupValueEntries<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>(
  valueLookup: ValueLookup<TValue, TMeta> | undefined,
  values: readonly TValue[],
): readonly (LookupEntry<TValue, TMeta> | undefined)[] {
  const valueKey = lookupValuesKey(values);

  useEffect(() => {
    if (!valueLookup) return;
    void valueLookup.loadMissingEntries(values);
  }, [valueLookup, valueKey]);

  const getSnapshot = useMemo(() => {
    let previous: readonly (LookupEntry<TValue, TMeta> | undefined)[] = [];
    return () => {
      const next = values.map((value) => valueLookup?.entryForValue(value));
      if (
        next.length === previous.length &&
        next.every((entry, index) => entry === previous[index])
      ) {
        return previous;
      }
      previous = next;
      return next;
    };
  }, [valueKey, valueLookup]);

  return useSyncExternalStore(
    (listener) =>
      valueLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop,
    getSnapshot,
  );
}

export function useLookupValueLabels<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>(
  valueLookup: ValueLookup<TValue, TMeta> | undefined,
  values: readonly TValue[],
): { labelFor(value: TValue): string | null } {
  const entries = useLookupValueEntries(valueLookup, values);
  const valueKey = lookupValuesKey(values);

  return useMemo(() => {
    void entries;
    return {
      labelFor(value: TValue): string | null {
        return valueLookup?.entryForValue(value)?.label ?? null;
      },
    };
  }, [entries, valueKey, valueLookup]);
}

export function useLookupOptions<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>(args: {
  valueLookup: ValueLookup<TValue, TMeta> | undefined;
  searchLookup: SearchLookup<TValue, TMeta> | undefined;
  selectedValues: readonly TValue[];
  searchText: string;
  limit: number;
  fields?: readonly string[];
}): readonly LookupEntry<TValue, TMeta>[] {
  const searchEntries = useLookupSearchResults(
    args.searchLookup,
    args.searchText,
    args.limit,
    args.fields,
  );
  const selectedEntries = useLookupValueEntries(
    args.valueLookup,
    args.selectedValues,
  );
  const selectedKey = lookupValuesKey(args.selectedValues);

  return useMemo(() => {
    const byValue = new Map<string, LookupEntry<TValue, TMeta>>();
    for (const [index, value] of args.selectedValues.entries()) {
      const key = lookupValueKey(value);
      byValue.set(
        key,
        selectedEntries[index] ?? { value, label: String(value) },
      );
    }
    for (const entry of searchEntries) {
      byValue.set(lookupValueKey(entry.value), entry);
    }
    return Array.from(byValue.values());
  }, [args.selectedValues, searchEntries, selectedEntries, selectedKey]);
}

function lookupValuesKey(values: readonly LookupValue[]): string {
  return values.map(lookupValueKey).join("\u0000");
}

function lookupFieldsKey(fields: readonly string[] | undefined): string {
  return Array.from(new Set(fields ?? []))
    .sort()
    .join("\u0000");
}

function subscribeNoop(): void {}
