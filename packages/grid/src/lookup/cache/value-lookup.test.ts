import { describe, expect, it, vi } from "vitest";
import {
  CachedValueLookup,
  type LookupValue,
  RecordValueLookup,
  StaticValueLookup,
} from "./value-lookup";

describe("StaticValueLookup", () => {
  it("shows a friendly label for a saved value that already lives in the app", () => {
    const lookup = new StaticValueLookup<LookupValue>([
      { value: "draft", label: "Draft" },
      { value: "paid", label: "Paid" },
    ]);

    expect(lookup.entryForValue("paid")).toEqual({
      value: "paid",
      label: "Paid",
    });
  });

  it("has nothing to load when all choices are already known", async () => {
    const lookup = new StaticValueLookup([{ value: "paid", label: "Paid" }]);

    await expect(lookup.loadMissingEntries(["paid"])).resolves.toBeUndefined();
  });
});

describe("RecordValueLookup", () => {
  it("turns a simple id-to-label object into lookup entries", () => {
    const lookup = new RecordValueLookup({
      low: "Low",
      normal: "Normal",
      high: "High",
    });

    expect(lookup.entryForValue("high")).toEqual({
      value: "high",
      label: "High",
    });
  });
});

describe("CachedValueLookup", () => {
  it("starts empty, loads labels for saved values, then lets callers read them right away", async () => {
    const loadEntriesForValues = vi.fn(async (values: readonly LookupValue[]) =>
      values.map((value) => ({ value, label: `Customer ${value}` })),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    expect(lookup.entryForValue("7")).toBeUndefined();

    await lookup.loadMissingEntries(["7"]);

    expect(loadEntriesForValues).toHaveBeenCalledWith(["7"]);
    expect(lookup.entryForValue("7")).toEqual({
      value: "7",
      label: "Customer 7",
    });
  });

  it("asks the loader only for values it does not already know", async () => {
    const loadEntriesForValues = vi.fn(async (values: readonly LookupValue[]) =>
      values.map((value) => ({ value, label: `Customer ${value}` })),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    await lookup.loadMissingEntries(["1", "7"]);
    await lookup.loadMissingEntries(["1", "7", "11"]);

    expect(loadEntriesForValues).toHaveBeenNthCalledWith(1, ["1", "7"]);
    expect(loadEntriesForValues).toHaveBeenNthCalledWith(2, ["11"]);
    expect(loadEntriesForValues).toHaveBeenCalledTimes(2);
  });

  it("cleans messy row values before loading so the backend gets one sorted list", async () => {
    const loadEntriesForValues = vi.fn(async (values: readonly LookupValue[]) =>
      values.map((value) => ({ value, label: `Value ${value}` })),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    await lookup.loadMissingEntries(["b", null, "a", undefined, "", "b", 2]);

    expect(loadEntriesForValues).toHaveBeenCalledWith([2, "a", "b"]);
  });

  it("passes numeric lookup values to the loader without stringifying them", async () => {
    const loadEntriesForValues = vi.fn(async (values: readonly LookupValue[]) =>
      values.map((value) => ({ value, label: `Value ${value}` })),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    await lookup.loadMissingEntries([1]);

    expect(loadEntriesForValues).toHaveBeenCalledWith([1]);
    expect(lookup.entryForValue(1)).toEqual({ value: 1, label: "Value 1" });
  });

  it("loads numeric and text ids with the same display string as separate values", async () => {
    const loadEntriesForValues = vi.fn(async (values: readonly LookupValue[]) =>
      values.map((value) => ({
        value,
        label: `${typeof value}:${String(value)}`,
      })),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    await lookup.loadMissingEntries([1, "1"]);

    expect(loadEntriesForValues).toHaveBeenCalledWith([1, "1"]);
    expect(lookup.entryForValue(1)?.label).toBe("number:1");
    expect(lookup.entryForValue("1")?.label).toBe("string:1");
  });

  it("stores numeric and text ids with the same display string as distinct entries", () => {
    const lookup = new StaticValueLookup<LookupValue>([
      { value: 1, label: "Numeric one" },
      { value: "1", label: "Text one" },
    ]);

    expect(lookup.entryForValue(1)?.label).toBe("Numeric one");
    expect(lookup.entryForValue("1")?.label).toBe("Text one");
  });

  it("shares work when the same value is requested again before the first request finishes", async () => {
    let finishLoading!: (
      entries: readonly { value: string; label: string }[],
    ) => void;
    const loadEntriesForValues = vi.fn(
      () =>
        new Promise<readonly { value: string; label: string }[]>((resolve) => {
          finishLoading = resolve;
        }),
    );
    const lookup = new CachedValueLookup({ loadEntriesForValues });

    const firstLoad = lookup.loadMissingEntries(["42"]);
    const secondLoad = lookup.loadMissingEntries(["42"]);

    expect(loadEntriesForValues).toHaveBeenCalledTimes(1);

    finishLoading([{ value: "42", label: "Globex" }]);
    await Promise.all([firstLoad, secondLoad]);

    expect(lookup.entryForValue("42")?.label).toBe("Globex");
  });

  it("tells subscribers after new labels arrive so screens can redraw", async () => {
    const lookup = new CachedValueLookup({
      loadEntriesForValues: async (values) =>
        values.map((value) => ({ value, label: `Value ${value}` })),
    });
    const listener = vi.fn();

    const unsubscribe = lookup.subscribeToLookupChanges(listener);
    await lookup.loadMissingEntries(["1"]);
    unsubscribe();
    await lookup.loadMissingEntries(["2"]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps late network answers so a cache stays usable after its subscriber leaves", async () => {
    let finishLoading!: (
      entries: readonly { value: string; label: string }[],
    ) => void;
    const lookup = new CachedValueLookup({
      loadEntriesForValues: () =>
        new Promise<readonly { value: string; label: string }[]>((resolve) => {
          finishLoading = resolve;
        }),
    });
    const listener = vi.fn();

    const unsubscribe = lookup.subscribeToLookupChanges(listener);
    const pendingLoad = lookup.loadMissingEntries(["9"]);
    unsubscribe();
    finishLoading([{ value: "9", label: "Late Label" }]);
    await pendingLoad;

    expect(lookup.entryForValue("9")?.label).toBe("Late Label");
    expect(listener).not.toHaveBeenCalled();
  });
});
