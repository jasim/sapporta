import type {
  LookupEntry,
  LookupSubscription,
  LookupValue,
} from "./value-lookup";

export type LookupSearchRequest = {
  searchText?: string;
  limit?: number;
  cursor?: string;
  /** Entry metadata fields displayed by the requesting picker. */
  fields?: readonly string[];
};

export type LookupSearchPage<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  entries: readonly LookupEntry<TValue, TMeta>[];
  nextCursor?: string;
};

export type SearchLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = LookupSubscription & {
  /**
   * React external-store invariant: callers use this as a
   * `useSyncExternalStore` snapshot reader. For the same normalized search
   * text, repeated reads must return the same array reference until the
   * lookup store actually changes; allocating a fresh `[]` or filtered array
   * on each read makes React treat the snapshot as changing during render.
   */
  cachedSearchResults(
    request?: Pick<LookupSearchRequest, "searchText" | "fields">,
  ): readonly LookupEntry<TValue, TMeta>[];
  loadSearchResults(
    request?: LookupSearchRequest,
  ): Promise<LookupSearchPage<TValue, TMeta>>;
};

type LoadEntriesForSearch<TValue extends LookupValue, TMeta> = (
  request: Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
    Pick<LookupSearchRequest, "cursor" | "fields">,
) => Promise<LookupSearchPage<TValue, TMeta>>;

type CachedSearchPage<TValue extends LookupValue, TMeta> = {
  page: LookupSearchPage<TValue, TMeta>;
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

function normalizeFields(fields: readonly string[] | undefined): string[] {
  return Array.from(new Set(fields ?? [])).sort();
}

function searchScopeKey(
  request: Pick<LookupSearchRequest, "searchText" | "fields">,
): string {
  return JSON.stringify({
    searchText: normalizeSearchText(request.searchText),
    fields: normalizeFields(request.fields),
  });
}

function searchRequestKey(request: LookupSearchRequest): string {
  return JSON.stringify({
    searchText: normalizeSearchText(request.searchText),
    fields: normalizeFields(request.fields),
    limit: request.limit,
    cursor: request.cursor,
  });
}

function entryMatchesSearchText(
  entry: LookupEntry<LookupValue, unknown>,
  searchText: string,
  fields: readonly string[],
): boolean {
  if (searchText === "") return true;

  const lowerSearchText = searchText.toLocaleLowerCase();
  return lookupEntrySearchValues(entry, fields).some((value) =>
    value.toLocaleLowerCase().includes(lowerSearchText),
  );
}

function lookupEntrySearchValues(
  entry: LookupEntry<LookupValue, unknown>,
  fields: readonly string[],
): string[] {
  const values = [entry.label];
  if (isRecord(entry.meta)) {
    for (const field of fields) {
      const value = entry.meta[field];
      if (isSearchableScalar(value)) values.push(String(value));
    }
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchableScalar(
  value: unknown,
): value is string | number | boolean | bigint {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  );
}

// Lookup caches are ordinary memoized objects; see value-lookup.ts for the
// lifetime rationale. Stale search responses are rejected by request key, not
// by disposal — a late response for a superseded search is dropped because its
// request key no longer matches the latest request for that text + field scope.
class SearchLookupStore {
  protected readonly listeners = new Set<() => void>();

  subscribeToLookupChanges(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected notifyLookupChanged(): void {
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

export class StaticSearchLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>
  extends SearchLookupStore
  implements SearchLookup<TValue, TMeta>
{
  private readonly entries: readonly LookupEntry<TValue, TMeta>[];
  private readonly entriesBySearchScope = new Map<
    string,
    readonly LookupEntry<TValue, TMeta>[]
  >();

  constructor(entries: readonly LookupEntry<TValue, TMeta>[]) {
    super();
    this.entries = entries;
  }

  cachedSearchResults(
    request?: Pick<LookupSearchRequest, "searchText" | "fields">,
  ): readonly LookupEntry<TValue, TMeta>[] {
    return this.entriesForRequest(request ?? {});
  }

  async loadSearchResults(
    request: LookupSearchRequest = {},
  ): Promise<LookupSearchPage<TValue, TMeta>> {
    const limit = normalizeLimit(request.limit, this.entries.length);
    const entries = this.entriesForRequest(request);
    return {
      entries: entries.length <= limit ? entries : entries.slice(0, limit),
    };
  }

  private entriesForRequest(
    request: Pick<LookupSearchRequest, "searchText" | "fields">,
  ): readonly LookupEntry<TValue, TMeta>[] {
    const searchText = normalizeSearchText(request.searchText);
    if (searchText === "") return this.entries;

    const fields = normalizeFields(request.fields);
    const scopeKey = searchScopeKey({ searchText, fields });
    const cached = this.entriesBySearchScope.get(scopeKey);
    if (cached) return cached;

    const entries = this.entries.filter((entry) =>
      entryMatchesSearchText(entry, searchText, fields),
    );
    this.entriesBySearchScope.set(scopeKey, entries);
    return entries;
  }
}

export class CachedSearchLookup<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>
  extends SearchLookupStore
  implements SearchLookup<TValue, TMeta>
{
  private readonly loadEntriesForSearch: LoadEntriesForSearch<TValue, TMeta>;
  private readonly defaultSearchLimit: number;
  private readonly maxCachedSearches: number;
  private readonly searchPagesByScope = new Map<
    string,
    CachedSearchPage<TValue, TMeta>
  >();
  private readonly loadingSearchesByRequest = new Map<
    string,
    Promise<LookupSearchPage<TValue, TMeta>>
  >();
  private readonly latestRequestBySearchScope = new Map<string, string>();

  constructor(args: {
    loadEntriesForSearch: LoadEntriesForSearch<TValue, TMeta>;
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
    request?: Pick<LookupSearchRequest, "searchText" | "fields">,
  ): readonly LookupEntry<TValue, TMeta>[] {
    const scopeKey = searchScopeKey(request ?? {});
    return (
      this.searchPagesByScope.get(scopeKey)?.page.entries ??
      EMPTY_SEARCH_RESULTS
    );
  }

  async loadSearchResults(
    request: LookupSearchRequest = {},
  ): Promise<LookupSearchPage<TValue, TMeta>> {
    const normalizedRequest = this.normalizeRequest(request);
    const requestKey = searchRequestKey(normalizedRequest);
    const scopeKey = searchScopeKey(normalizedRequest);
    const cachedPage = this.searchPagesByScope.get(scopeKey);
    if (cachedPage?.requestKey === requestKey) return cachedPage.page;

    const pending = this.loadingSearchesByRequest.get(requestKey);
    if (pending) return pending;

    this.latestRequestBySearchScope.set(scopeKey, requestKey);
    const load = this.loadAndStoreSearchPage(
      normalizedRequest,
      scopeKey,
      requestKey,
    );
    this.loadingSearchesByRequest.set(requestKey, load);
    return load;
  }

  private normalizeRequest(
    request: LookupSearchRequest,
  ): Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
    Pick<LookupSearchRequest, "cursor" | "fields"> {
    const fields = normalizeFields(request.fields);
    return {
      searchText: normalizeSearchText(request.searchText),
      limit: normalizeLimit(request.limit, this.defaultSearchLimit),
      ...(fields.length === 0 ? {} : { fields }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    };
  }

  private async loadAndStoreSearchPage(
    request: Required<Pick<LookupSearchRequest, "searchText" | "limit">> &
      Pick<LookupSearchRequest, "cursor" | "fields">,
    scopeKey: string,
    requestKey: string,
  ): Promise<LookupSearchPage<TValue, TMeta>> {
    try {
      const page = await this.loadEntriesForSearch(request);
      if (this.latestRequestBySearchScope.get(scopeKey) === requestKey) {
        this.searchPagesByScope.set(scopeKey, { page, requestKey });
        this.evictOldSearches();
        this.notifyLookupChanged();
      }
      return page;
    } finally {
      this.loadingSearchesByRequest.delete(requestKey);
    }
  }

  private evictOldSearches(): void {
    while (this.searchPagesByScope.size > this.maxCachedSearches) {
      const oldestScope = this.searchPagesByScope.keys().next().value;
      if (oldestScope === undefined) return;
      this.searchPagesByScope.delete(oldestScope);
    }
  }
}
