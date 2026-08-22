export type LookupValue = string | number;

export function isLookupValue(value: unknown): value is LookupValue {
  return typeof value === "string" || typeof value === "number";
}

/** Tagged by `typeof`: a numeric id and its string form are distinct keys. */
export function lookupValueKey(value: LookupValue): string {
  return `${typeof value}:${String(value)}`;
}

export function lookupValueEquals(a: LookupValue, b: LookupValue): boolean {
  return lookupValueKey(a) === lookupValueKey(b);
}

export type LookupEntry<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  value: TValue;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Source data available to custom lookup item renderers. */
  meta?: TMeta;
};

export type LookupSubscription = {
  subscribeToLookupChanges(listener: () => void): () => void;
};

export type ValueLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = LookupSubscription & {
  entryForValue(value: unknown): LookupEntry<TValue, TMeta> | undefined;
  loadMissingEntries(values: readonly unknown[]): Promise<void>;
};

type LoadEntriesForValues<TValue extends LookupValue, TMeta> = (
  values: readonly TValue[],
) => Promise<readonly LookupEntry<TValue, TMeta>[]>;

type ValueRequest<TValue extends LookupValue> = {
  key: string;
  value: TValue;
};

function valueKey(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (isLookupValue(value)) return lookupValueKey(value);
  return undefined;
}

function loadValue<TValue extends LookupValue>(
  value: unknown,
): TValue | undefined {
  if (value == null || value === "") return undefined;
  if (!isLookupValue(value)) return undefined;
  return value as TValue;
}

function uniqueSortedValueRequests<TValue extends LookupValue>(
  values: readonly unknown[],
): ValueRequest<TValue>[] {
  const byKey = new Map<string, TValue>();
  for (const value of values) {
    const requestValue = loadValue<TValue>(value);
    const key =
      requestValue === undefined ? undefined : lookupValueKey(requestValue);
    if (key === undefined || requestValue === undefined) continue;
    byKey.set(key, requestValue);
  }
  return Array.from(byKey, ([key, value]) => ({ key, value })).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}

// Lookup caches are ordinary memoized objects. They stay live for as long as a
// reference exists and rely on `useSyncExternalStore` to manage React
// subscriptions. An in-flight request that resolves after every listener has
// unsubscribed simply stores its entries and notifies an empty listener set —
// a no-op. The cache remains usable if a new subscriber attaches later.
class ValueLookupStore<TValue extends LookupValue, TMeta> {
  protected readonly entriesByValue = new Map<
    string,
    LookupEntry<TValue, TMeta>
  >();
  private readonly listeners = new Set<() => void>();

  entryForValue(value: unknown): LookupEntry<TValue, TMeta> | undefined {
    const key = valueKey(value);
    return key === undefined ? undefined : this.entriesByValue.get(key);
  }

  subscribeToLookupChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected setEntries(
    entries: readonly LookupEntry<TValue, TMeta>[],
  ): boolean {
    let changed = false;
    for (const entry of entries) {
      const key = valueKey(entry.value);
      if (key === undefined) continue;
      this.entriesByValue.set(key, entry);
      changed = true;
    }
    return changed;
  }

  protected notifyLookupChanged(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

export class StaticValueLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>
  extends ValueLookupStore<TValue, TMeta>
  implements ValueLookup<TValue, TMeta>
{
  constructor(entries: readonly LookupEntry<TValue, TMeta>[]) {
    super();
    this.setEntries(entries);
  }

  async loadMissingEntries(_values: readonly unknown[]): Promise<void> {
    return;
  }
}

export class RecordValueLookup
  extends StaticValueLookup<string, unknown>
  implements ValueLookup<string, unknown>
{
  constructor(labelsByValue: Record<string, string>) {
    super(
      Object.entries(labelsByValue).map(([value, label]) => ({ value, label })),
    );
  }
}

export class CachedValueLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>
  extends ValueLookupStore<TValue, TMeta>
  implements ValueLookup<TValue, TMeta>
{
  private readonly loadEntriesForValues: LoadEntriesForValues<TValue, TMeta>;
  private readonly loadingEntriesByValueKey = new Map<string, Promise<void>>();

  constructor(args: {
    loadEntriesForValues: LoadEntriesForValues<TValue, TMeta>;
  }) {
    super();
    this.loadEntriesForValues = args.loadEntriesForValues;
  }

  async loadMissingEntries(values: readonly unknown[]): Promise<void> {
    const missingRequests = uniqueSortedValueRequests<TValue>(values).filter(
      ({ key }) => !this.entriesByValue.has(key),
    );
    if (missingRequests.length === 0) return;

    const pendingLoads: Promise<void>[] = [];
    const requestsToLoad: ValueRequest<TValue>[] = [];
    for (const request of missingRequests) {
      const { key } = request;
      const pending = this.loadingEntriesByValueKey.get(key);
      if (pending) {
        pendingLoads.push(pending);
      } else {
        requestsToLoad.push(request);
      }
    }

    if (requestsToLoad.length > 0) {
      const load = this.loadAndStoreEntries(requestsToLoad);
      for (const { key } of requestsToLoad) {
        this.loadingEntriesByValueKey.set(key, load);
      }
      pendingLoads.push(load);
    }

    await Promise.all(pendingLoads);
  }

  private async loadAndStoreEntries(
    requestsToLoad: readonly ValueRequest<TValue>[],
  ): Promise<void> {
    try {
      const entries = await this.loadEntriesForValues(
        requestsToLoad.map((request) => request.value),
      );
      const changed = this.setEntries(entries);
      if (changed) this.notifyLookupChanged();
    } finally {
      for (const { key } of requestsToLoad) {
        this.loadingEntriesByValueKey.delete(key);
      }
    }
  }
}
