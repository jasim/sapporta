import { describe, expect, it, vi } from "vitest";
import { CachedSearchLookup, StaticSearchLookup } from "./search-lookup";

describe("StaticSearchLookup", () => {
  it("shows all local choices before the user types anything", () => {
    const lookup = new StaticSearchLookup([
      { value: "draft", label: "Draft" },
      { value: "paid", label: "Paid" },
      { value: "void", label: "Void" },
    ]);

    expect(lookup.cachedSearchResults()).toEqual([
      { value: "draft", label: "Draft" },
      { value: "paid", label: "Paid" },
      { value: "void", label: "Void" },
    ]);
  });

  it("filters local choices by the words the user typed", async () => {
    const lookup = new StaticSearchLookup([
      { value: "draft", label: "Draft invoice" },
      { value: "paid", label: "Paid invoice" },
      { value: "void", label: "Cancelled invoice" },
    ]);

    await lookup.loadSearchResults({ searchText: "paid", limit: 50 });

    expect(lookup.cachedSearchResults({ searchText: "paid" })).toEqual([
      { value: "paid", label: "Paid invoice" },
    ]);
  });

  it("returns identity-stable cached results for React snapshot readers", () => {
    const lookup = new StaticSearchLookup([
      { value: "draft", label: "Draft invoice" },
      { value: "paid", label: "Paid invoice" },
      { value: "void", label: "Cancelled invoice" },
    ]);

    const allEntries = lookup.cachedSearchResults();
    expect(lookup.cachedSearchResults({ searchText: "" })).toBe(allEntries);

    const paidEntries = lookup.cachedSearchResults({ searchText: "  paid " });
    expect(lookup.cachedSearchResults({ searchText: "paid" })).toBe(
      paidEntries,
    );

    const noEntries = lookup.cachedSearchResults({ searchText: "missing" });
    expect(lookup.cachedSearchResults({ searchText: "missing" })).toBe(
      noEntries,
    );
  });

  it("keeps local searching synchronous even when callers use the loading API", async () => {
    const lookup = new StaticSearchLookup([
      { value: "draft", label: "Draft" },
      { value: "paid", label: "Paid" },
    ]);

    await expect(
      lookup.loadSearchResults({ searchText: "dr", limit: 1 }),
    ).resolves.toEqual({
      entries: [{ value: "draft", label: "Draft" }],
    });
  });
});

describe("CachedSearchLookup", () => {
  it("starts with no remote choices, loads the first page, then lets callers read it right away", async () => {
    const loadEntriesForSearch = vi.fn(async () => ({
      entries: [
        { value: "1", label: "Acme" },
        { value: "2", label: "Globex" },
      ],
    }));
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    expect(lookup.cachedSearchResults({ searchText: "" })).toEqual([]);

    await lookup.loadSearchResults({ searchText: "", limit: 50 });

    expect(lookup.cachedSearchResults({ searchText: "" })).toEqual([
      { value: "1", label: "Acme" },
      { value: "2", label: "Globex" },
    ]);
  });

  it("returns identity-stable cached pages and empty snapshots", async () => {
    const loadEntriesForSearch = vi.fn(async ({ searchText }) => ({
      entries: [{ value: searchText || "all", label: "Loaded" }],
    }));
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    const emptyEntries = lookup.cachedSearchResults({ searchText: "cash" });
    expect(lookup.cachedSearchResults({ searchText: "cash" })).toBe(
      emptyEntries,
    );

    await lookup.loadSearchResults({ searchText: "cash", limit: 50 });
    const loadedEntries = lookup.cachedSearchResults({ searchText: "cash" });
    expect(loadedEntries).not.toBe(emptyEntries);
    expect(lookup.cachedSearchResults({ searchText: "cash" })).toBe(
      loadedEntries,
    );
  });

  it("cleans up search text and limit before asking the remote source", async () => {
    const loadEntriesForSearch = vi.fn(async () => ({ entries: [] }));
    const lookup = new CachedSearchLookup({
      loadEntriesForSearch,
      defaultSearchLimit: 25,
    });

    await lookup.loadSearchResults({ searchText: "  cash  " });

    expect(loadEntriesForSearch).toHaveBeenCalledWith({
      searchText: "cash",
      limit: 25,
    });
  });

  it("reuses a cached page when the same search is requested again", async () => {
    const loadEntriesForSearch = vi.fn(async ({ searchText }) => ({
      entries: [{ value: searchText || "all", label: `Result ${searchText}` }],
    }));
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    await lookup.loadSearchResults({ searchText: "ac", limit: 50 });
    await lookup.loadSearchResults({ searchText: "ac", limit: 50 });

    expect(loadEntriesForSearch).toHaveBeenCalledTimes(1);
  });

  it("loads again when the same words ask for a different page size", async () => {
    const loadEntriesForSearch = vi.fn(async ({ searchText, limit }) => ({
      entries: [
        { value: `${searchText}-${limit}`, label: `${searchText} ${limit}` },
      ],
    }));
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    await lookup.loadSearchResults({ searchText: "ac", limit: 10 });
    await lookup.loadSearchResults({ searchText: "ac", limit: 20 });

    expect(loadEntriesForSearch).toHaveBeenNthCalledWith(1, {
      searchText: "ac",
      limit: 10,
    });
    expect(loadEntriesForSearch).toHaveBeenNthCalledWith(2, {
      searchText: "ac",
      limit: 20,
    });
  });

  it("shares work when the same search is requested before the first request finishes", async () => {
    let finishLoading!: (page: {
      entries: readonly { value: string; label: string }[];
    }) => void;
    const loadEntriesForSearch = vi.fn(
      () =>
        new Promise<{
          entries: readonly { value: string; label: string }[];
        }>((resolve) => {
          finishLoading = resolve;
        }),
    );
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    const firstLoad = lookup.loadSearchResults({
      searchText: "cash",
      limit: 20,
    });
    const secondLoad = lookup.loadSearchResults({
      searchText: "cash",
      limit: 20,
    });

    expect(loadEntriesForSearch).toHaveBeenCalledTimes(1);

    finishLoading({ entries: [{ value: "cash", label: "Cash Account" }] });
    await Promise.all([firstLoad, secondLoad]);

    expect(lookup.cachedSearchResults({ searchText: "cash" })).toEqual([
      { value: "cash", label: "Cash Account" },
    ]);
  });

  it("keeps the newest answer when two searches for the same words finish out of order", async () => {
    const finishLoadingByLimit = new Map<
      number,
      (page: { entries: readonly { value: string; label: string }[] }) => void
    >();
    const loadEntriesForSearch = vi.fn(
      ({ limit }: { limit: number }) =>
        new Promise<{
          entries: readonly { value: string; label: string }[];
        }>((resolve) => {
          finishLoadingByLimit.set(limit, resolve);
        }),
    );
    const lookup = new CachedSearchLookup({ loadEntriesForSearch });

    const smallPageLoad = lookup.loadSearchResults({
      searchText: "cash",
      limit: 10,
    });
    const biggerPageLoad = lookup.loadSearchResults({
      searchText: "cash",
      limit: 20,
    });

    finishLoadingByLimit.get(20)!({
      entries: [{ value: "20", label: "Twenty results" }],
    });
    await biggerPageLoad;
    finishLoadingByLimit.get(10)!({
      entries: [{ value: "10", label: "Ten results" }],
    });
    await smallPageLoad;

    expect(lookup.cachedSearchResults({ searchText: "cash" })).toEqual([
      { value: "20", label: "Twenty results" },
    ]);
  });

  it("tells subscribers after search results arrive so pickers can redraw", async () => {
    const lookup = new CachedSearchLookup({
      loadEntriesForSearch: async ({ searchText }) => ({
        entries: [{ value: searchText || "all", label: "Loaded" }],
      }),
    });
    const listener = vi.fn();

    const unsubscribe = lookup.subscribeToLookupChanges(listener);
    await lookup.loadSearchResults({ searchText: "cash", limit: 20 });
    unsubscribe();
    await lookup.loadSearchResults({ searchText: "bank", limit: 20 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forgets older searches when the cache is full", async () => {
    const lookup = new CachedSearchLookup({
      loadEntriesForSearch: async ({ searchText }) => ({
        entries: [
          { value: searchText || "all", label: `Result ${searchText}` },
        ],
      }),
      maxCachedSearches: 2,
    });

    await lookup.loadSearchResults({ searchText: "first", limit: 20 });
    await lookup.loadSearchResults({ searchText: "second", limit: 20 });
    await lookup.loadSearchResults({ searchText: "third", limit: 20 });

    expect(lookup.cachedSearchResults({ searchText: "first" })).toEqual([]);
    expect(lookup.cachedSearchResults({ searchText: "second" })).toEqual([
      { value: "second", label: "Result second" },
    ]);
    expect(lookup.cachedSearchResults({ searchText: "third" })).toEqual([
      { value: "third", label: "Result third" },
    ]);
  });

  it("drops a late response for a superseded search without notifying", async () => {
    let finishLateLoad!: (page: {
      entries: readonly { value: string; label: string }[];
    }) => void;
    const lookup = new CachedSearchLookup({
      loadEntriesForSearch: ({ limit }) =>
        limit === 20
          ? new Promise<{
              entries: readonly { value: string; label: string }[];
            }>((resolve) => {
              finishLateLoad = resolve;
            })
          : Promise.resolve({
              entries: [{ value: "fresh", label: "Fresh Result" }],
            }),
    });
    const listener = vi.fn();

    const unsubscribe = lookup.subscribeToLookupChanges(listener);
    const pendingLateLoad = lookup.loadSearchResults({
      searchText: "cash",
      limit: 20,
    });
    await lookup.loadSearchResults({ searchText: "cash", limit: 30 });
    finishLateLoad({ entries: [{ value: "late", label: "Late Result" }] });
    await pendingLateLoad;
    unsubscribe();

    expect(lookup.cachedSearchResults({ searchText: "cash" })).toEqual([
      { value: "fresh", label: "Fresh Result" },
    ]);
  });
});
