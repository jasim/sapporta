import type {
  LookupEntry,
  LookupSubscription,
  LookupValue,
} from "./value-lookup";

export type LookupSearchRequest = {
  searchText?: string;
  limit?: number;
  cursor?: string;
};

export type LookupSearchPage<TValue extends LookupValue = LookupValue> = {
  entries: readonly LookupEntry<TValue>[];
  nextCursor?: string;
};

export type SearchLookup<TValue extends LookupValue = LookupValue> =
  LookupSubscription & {
    /**
     * React external-store invariant: callers use this as a
     * `useSyncExternalStore` snapshot reader. For the same normalized search
     * text, repeated reads must return the same array reference until the
     * lookup store actually changes; allocating a fresh `[]` or filtered array
     * on each read makes React treat the snapshot as changing during render.
     */
    cachedSearchResults(
      request?: Pick<LookupSearchRequest, "searchText">,
    ): readonly LookupEntry<TValue>[];
    loadSearchResults(
      request?: LookupSearchRequest,
    ): Promise<LookupSearchPage<TValue>>;
  };

type LoadEntriesForSearch<TValue extends LookupValue> = (
  request: Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
    Pick<LookupSearchRequest, "cursor">,
) => Promise<LookupSearchPage<TValue>>;

type CachedSearchPage<TValue extends LookupValue> = {
  page: LookupSearchPage<TValue>;
  requestKey: string;
};

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_MAX_CACHED_SEARCHES = 25;
const EMPTY_SEARCH_RESULTS: readonly [] = [];

function normalizeSearchText(searchText: string | undefined): string {
  return searchText?.trim() ?? "";
}

function normalizeLimit(
  limit: number | undefined,
  defaultLimit: number,
): number {
  if (limit === undefined) return defaultLimit;
  return Math.max(0, Math.floor(limit));
}

function searchRequestKey(request: LookupSearchRequest): string {
  return JSON.stringify({
    searchText: normalizeSearchText(request.searchText),
    limit: request.limit,
    cursor: request.cursor,
  });
}

function entryMatchesSearchText(
  entry: LookupEntry<LookupValue>,
  searchText: string,
): boolean {
  if (searchText === "") return true;

  const lowerSearchText = searchText.toLocaleLowerCase();
  return (
    entry.label.toLocaleLowerCase().includes(lowerSearchText) ||
    (entry.description?.toLocaleLowerCase().includes(lowerSearchText) ?? false)
  );
}

class SearchLookupStore<TValue extends LookupValue> {
  protected readonly listeners = new Set<() => void>();
  protected disposed = false;

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
  }

  protected notifyLookupChanged(): void {
    if (this.disposed) return;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

export class StaticSearchLookup<TValue extends LookupValue = LookupValue>
  extends SearchLookupStore<TValue>
  implements SearchLookup<TValue>
{
  private readonly entries: readonly LookupEntry<TValue>[];
  private readonly entriesBySearchText = new Map<
    string,
    readonly LookupEntry<TValue>[]
  >();

  constructor(entries: readonly LookupEntry<TValue>[]) {
    super();
    this.entries = entries;
  }

  cachedSearchResults(
    request?: Pick<LookupSearchRequest, "searchText">,
  ): readonly LookupEntry<TValue>[] {
    if (this.disposed) return EMPTY_SEARCH_RESULTS;
    return this.entriesForSearchText(normalizeSearchText(request?.searchText));
  }

  async loadSearchResults(
    request: LookupSearchRequest = {},
  ): Promise<LookupSearchPage<TValue>> {
    if (this.disposed) return { entries: EMPTY_SEARCH_RESULTS };

    const searchText = normalizeSearchText(request.searchText);
    const limit = normalizeLimit(request.limit, this.entries.length);
    const entries = this.entriesForSearchText(searchText);
    return {
      entries: entries.length <= limit ? entries : entries.slice(0, limit),
    };
  }

  override dispose(): void {
    super.dispose();
    this.entriesBySearchText.clear();
  }

  private entriesForSearchText(
    searchText: string,
  ): readonly LookupEntry<TValue>[] {
    if (searchText === "") return this.entries;

    const cached = this.entriesBySearchText.get(searchText);
    if (cached) return cached;

    const entries = this.entries.filter((entry) =>
      entryMatchesSearchText(entry, searchText),
    );
    this.entriesBySearchText.set(searchText, entries);
    return entries;
  }
}

export class CachedSearchLookup<TValue extends LookupValue = LookupValue>
  extends SearchLookupStore<TValue>
  implements SearchLookup<TValue>
{
  private readonly loadEntriesForSearch: LoadEntriesForSearch<TValue>;
  private readonly defaultSearchLimit: number;
  private readonly maxCachedSearches: number;
  private readonly searchPagesByText = new Map<
    string,
    CachedSearchPage<TValue>
  >();
  private readonly loadingSearchesByRequest = new Map<
    string,
    Promise<LookupSearchPage<TValue>>
  >();
  private readonly latestRequestBySearchText = new Map<string, string>();

  constructor(args: {
    loadEntriesForSearch: LoadEntriesForSearch<TValue>;
    defaultSearchLimit?: number;
    maxCachedSearches?: number;
  }) {
    super();
    this.loadEntriesForSearch = args.loadEntriesForSearch;
    this.defaultSearchLimit = normalizeLimit(
      args.defaultSearchLimit,
      DEFAULT_SEARCH_LIMIT,
    );
    this.maxCachedSearches = normalizeLimit(
      args.maxCachedSearches,
      DEFAULT_MAX_CACHED_SEARCHES,
    );
  }

  cachedSearchResults(
    request?: Pick<LookupSearchRequest, "searchText">,
  ): readonly LookupEntry<TValue>[] {
    if (this.disposed) return EMPTY_SEARCH_RESULTS;

    const searchText = normalizeSearchText(request?.searchText);
    return (
      this.searchPagesByText.get(searchText)?.page.entries ??
      EMPTY_SEARCH_RESULTS
    );
  }

  async loadSearchResults(
    request: LookupSearchRequest = {},
  ): Promise<LookupSearchPage<TValue>> {
    if (this.disposed) return { entries: EMPTY_SEARCH_RESULTS };

    const normalizedRequest = this.normalizeRequest(request);
    const requestKey = searchRequestKey(normalizedRequest);
    const cachedPage = this.searchPagesByText.get(normalizedRequest.searchText);
    if (cachedPage?.requestKey === requestKey) return cachedPage.page;

    const pending = this.loadingSearchesByRequest.get(requestKey);
    if (pending) return pending;

    this.latestRequestBySearchText.set(
      normalizedRequest.searchText,
      requestKey,
    );
    const load = this.loadAndStoreSearchPage(normalizedRequest, requestKey);
    this.loadingSearchesByRequest.set(requestKey, load);
    return load;
  }

  override dispose(): void {
    super.dispose();
    this.searchPagesByText.clear();
    this.loadingSearchesByRequest.clear();
    this.latestRequestBySearchText.clear();
  }

  private normalizeRequest(
    request: LookupSearchRequest,
  ): Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
    Pick<LookupSearchRequest, "cursor"> {
    return {
      searchText: normalizeSearchText(request.searchText),
      limit: normalizeLimit(request.limit, this.defaultSearchLimit),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    };
  }

  private async loadAndStoreSearchPage(
    request: Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
      Pick<LookupSearchRequest, "cursor">,
    requestKey: string,
  ): Promise<LookupSearchPage<TValue>> {
    try {
      const page = await this.loadEntriesForSearch(request);
      if (
        !this.disposed &&
        this.latestRequestBySearchText.get(request.searchText) === requestKey
      ) {
        this.searchPagesByText.set(request.searchText, { page, requestKey });
        this.evictOldSearches();
        this.notifyLookupChanged();
      }
      return page;
    } finally {
      this.loadingSearchesByRequest.delete(requestKey);
    }
  }

  private evictOldSearches(): void {
    while (this.searchPagesByText.size > this.maxCachedSearches) {
      const oldestSearchText = this.searchPagesByText.keys().next().value;
      if (oldestSearchText === undefined) return;
      this.searchPagesByText.delete(oldestSearchText);
    }
  }
}
