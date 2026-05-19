export type LookupValue = string | number | boolean;

export type LookupEntry<TValue extends LookupValue = LookupValue> = {
  value: TValue;
  label: string;
  description?: string;
  disabled?: boolean;
  meta?: unknown;
};

export type LookupSubscription = {
  subscribeToLookupChanges(listener: () => void): () => void;
  dispose?(): void;
};

export type ValueLookup<TValue extends LookupValue = LookupValue> =
  LookupSubscription & {
    entryForValue(value: unknown): LookupEntry<TValue> | undefined;
    loadMissingEntries(values: readonly unknown[]): Promise<void>;
  };

type LoadEntriesForValues<TValue extends LookupValue> = (
  values: readonly string[],
) => Promise<readonly LookupEntry<TValue>[]>;

function valueKey(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return undefined;
}

function uniqueSortedValueKeys(values: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => valueKey(value))
        .filter((key): key is string => key !== undefined),
    ),
  ).sort();
}

class ValueLookupStore<TValue extends LookupValue> {
  protected readonly entriesByValue = new Map<string, LookupEntry<TValue>>();
  private readonly listeners = new Set<() => void>();
  protected disposed = false;

  entryForValue(value: unknown): LookupEntry<TValue> | undefined {
    const key = valueKey(value);
    return key === undefined ? undefined : this.entriesByValue.get(key);
  }

  subscribeToLookupChanges(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.entriesByValue.clear();
  }

  protected setEntries(entries: readonly LookupEntry<TValue>[]): boolean {
    if (this.disposed) return false;

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
    if (this.disposed) return;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

export class StaticValueLookup<TValue extends LookupValue = LookupValue>
  extends ValueLookupStore<TValue>
  implements ValueLookup<TValue>
{
  constructor(entries: readonly LookupEntry<TValue>[]) {
    super();
    this.setEntries(entries);
  }

  async loadMissingEntries(_values: readonly unknown[]): Promise<void> {
    return;
  }
}

export class RecordValueLookup
  extends StaticValueLookup<string>
  implements ValueLookup<string>
{
  constructor(labelsByValue: Record<string, string>) {
    super(
      Object.entries(labelsByValue).map(([value, label]) => ({ value, label })),
    );
  }
}

export class CachedValueLookup<TValue extends LookupValue = LookupValue>
  extends ValueLookupStore<TValue>
  implements ValueLookup<TValue>
{
  private readonly loadEntriesForValues: LoadEntriesForValues<TValue>;
  private readonly loadingEntriesByValueKey = new Map<string, Promise<void>>();

  constructor(args: { loadEntriesForValues: LoadEntriesForValues<TValue> }) {
    super();
    this.loadEntriesForValues = args.loadEntriesForValues;
  }

  async loadMissingEntries(values: readonly unknown[]): Promise<void> {
    if (this.disposed) return;

    const missingKeys = uniqueSortedValueKeys(values).filter(
      (key) => !this.entriesByValue.has(key),
    );
    if (missingKeys.length === 0) return;

    const pendingLoads: Promise<void>[] = [];
    const keysToLoad: string[] = [];
    for (const key of missingKeys) {
      const pending = this.loadingEntriesByValueKey.get(key);
      if (pending) {
        pendingLoads.push(pending);
      } else {
        keysToLoad.push(key);
      }
    }

    if (keysToLoad.length > 0) {
      const load = this.loadAndStoreEntries(keysToLoad);
      for (const key of keysToLoad) {
        this.loadingEntriesByValueKey.set(key, load);
      }
      pendingLoads.push(load);
    }

    await Promise.all(pendingLoads);
  }

  override dispose(): void {
    super.dispose();
    this.loadingEntriesByValueKey.clear();
  }

  private async loadAndStoreEntries(keysToLoad: readonly string[]): Promise<void> {
    try {
      const entries = await this.loadEntriesForValues(keysToLoad);
      const changed = this.setEntries(entries);
      if (changed) this.notifyLookupChanged();
    } finally {
      for (const key of keysToLoad) {
        this.loadingEntriesByValueKey.delete(key);
      }
    }
  }
}
