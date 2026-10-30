import {
  CachedSearchLookup,
  CachedValueLookup,
  type LookupEntry,
  type LookupSearchPage,
  type LookupSearchRequest,
  type LookupValue,
  type SearchLookup,
  type ValueLookup,
} from "@sapporta/grid/lookup";
import { lookupEntryMatches } from "@sapporta/shared";
import {
  MAX_LOOKUP_IDS,
  type ComputedValues,
  type LookupTreeEntry,
  type Row,
} from "@sapporta/shared/contracts";
import {
  fetchLookup,
  fetchLookupSearch,
  fetchLookupTree,
  type LookupNarrowing,
} from "./api/lookup";

export type TableLookupSource = {
  valueLookup: ValueLookup<LookupValue, Row>;
  searchLookup: SearchLookup<LookupValue, Row>;
  /** The table's rows as a tree, for a table that declares `meta.tree`. */
  treeLookup: CachedTreeLookup;
};

/** A table lookup source whose caches can be read again after a write. */
export type CachedTableLookupSource = {
  valueLookup: CachedValueLookup<LookupValue, Row>;
  searchLookup: TableSearchLookup;
  treeLookup: CachedTreeLookup;
};

/** A table's search, whose cached results can be read again after a write. */
export type TableSearchLookup = SearchLookup<LookupValue, Row> & {
  /** Marks every cached search as out of date, such as after a write. */
  markSearchesStale(): void;
};

/**
 * Where a lookup's search runs:
 * - `"server"`: in SQL on the server, for any table, however large. A
 *   grid's foreign-key cell searches this way.
 * - `"client"`: for a tree table whose picker has read the whole narrowed
 *   tree, in the browser: every match, in tree order, without a request
 *   per keystroke. Until that tree is read, or when it could not be read,
 *   such as one too large to send, the search runs on the server.
 *
 * Both find the same rows, by `lookupEntryMatches`.
 */
export type LookupSearchMode = "server" | "client";

/** What one lookup asks for beside its entries, and where it stores them. */
export type LookupComputedRequest = {
  fields: readonly string[];
  /** Receives the response's computed values, before its entries are stored. */
  store(values: ComputedValues): void;
};

/** What a tree lookup holds: the tree it last read, and whether a read is
 *  under way or failed. The entries stay while the tree is read again. */
export type TreeLookupState = {
  readonly entries: readonly LookupTreeEntry[];
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly error?: unknown;
};

/**
 * The rows of a tree table as a tree picker draws them, read once and kept.
 * `reload()` reads them again after a write, keeping the old tree drawn
 * until the new one arrives.
 */
export class CachedTreeLookup {
  private current: TreeLookupState = { entries: [], status: "idle" };
  private readonly listeners = new Set<() => void>();
  private sent = 0;

  constructor(
    private readonly loadTree: () => Promise<readonly LookupTreeEntry[]>,
  ) {}

  state(): TreeLookupState {
    return this.current;
  }

  /** Reads the tree, unless it was read already or is being read. */
  load(): void {
    if (this.current.status === "idle") void this.read();
  }

  /** Reads the tree again, if it was ever read. */
  reload(): void {
    if (this.current.status !== "idle") void this.read();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async read(): Promise<void> {
    const sent = ++this.sent;
    this.set({ entries: this.current.entries, status: "loading" });
    try {
      const entries = await this.loadTree();
      if (sent === this.sent) this.set({ entries, status: "ready" });
    } catch (error) {
      if (sent === this.sent) {
        this.set({ entries: this.current.entries, status: "error", error });
      }
    }
  }

  private set(state: TreeLookupState): void {
    this.current = state;
    for (const listener of Array.from(this.listeners)) listener();
  }
}

/**
 * A `"client"` search: the choices of the tree that `tree` holds, matched in
 * the browser, while it holds the whole tree; `server` otherwise.
 */
class TreeSearchLookup implements TableSearchLookup {
  // The matches of each search text and fields, for the tree they were found
  // in. A read returns the same array until the tree changes.
  private matchedIn: readonly LookupTreeEntry[] | undefined;
  private readonly matches = new Map<
    string,
    readonly LookupEntry<LookupValue, Row>[]
  >();

  constructor(
    private readonly tree: CachedTreeLookup,
    private readonly server: CachedSearchLookup<LookupValue, Row>,
  ) {}

  subscribeToLookupChanges(listener: () => void): () => void {
    const stopTree = this.tree.subscribe(listener);
    const stopServer = this.server.subscribeToLookupChanges(listener);
    return () => {
      stopTree();
      stopServer();
    };
  }

  cachedSearchResults(
    request: Pick<LookupSearchRequest, "searchText" | "fields"> = {},
  ): readonly LookupEntry<LookupValue, Row>[] {
    const tree = this.heldTree();
    if (tree === undefined) return this.server.cachedSearchResults(request);
    return this.matchesIn(tree, request);
  }

  async loadSearchResults(
    request: LookupSearchRequest = {},
  ): Promise<LookupSearchPage<LookupValue, Row>> {
    const tree = this.heldTree();
    if (tree === undefined) return this.server.loadSearchResults(request);
    return { entries: this.matchesIn(tree, request) };
  }

  markSearchesStale(): void {
    this.server.markSearchesStale();
  }

  // The whole tree, once it is read; a tree being read again may be out of
  // date, and one that failed holds nothing.
  private heldTree(): readonly LookupTreeEntry[] | undefined {
    const state = this.tree.state();
    return state.status === "ready" ? state.entries : undefined;
  }

  private matchesIn(
    tree: readonly LookupTreeEntry[],
    request: Pick<LookupSearchRequest, "searchText" | "fields">,
  ): readonly LookupEntry<LookupValue, Row>[] {
    if (tree !== this.matchedIn) {
      this.matches.clear();
      this.matchedIn = tree;
    }
    const searchText = request.searchText ?? "";
    const fields = request.fields ?? [];
    const key = JSON.stringify([
      searchText.trim(),
      Array.from(new Set(fields)).sort(),
    ]);
    const cached = this.matches.get(key);
    if (cached) return cached;
    const found = tree.filter(
      (entry) =>
        entry.role === "choice" &&
        lookupEntryMatches(entry, searchText, fields),
    );
    this.matches.set(key, found);
    return found;
  }
}

export function createTableLookupSource(
  tableName: string,
  /** Called as each lookup is sent. */
  computed: (() => LookupComputedRequest) | undefined,
  /** Narrows the search; lookups by id are never narrowed. */
  narrowing: LookupNarrowing | undefined,
  search: LookupSearchMode,
): CachedTableLookupSource {
  const serverSearch = new CachedSearchLookup<LookupValue, Row>({
    loadEntriesForSearch: async ({ searchText, limit, fields }) => {
      const request = computed?.();
      const response = await fetchLookupSearch(
        tableName,
        searchText,
        limit,
        fields,
        request?.fields,
        narrowing,
      );
      if (response.computed) request?.store(response.computed);
      return { entries: response.entries };
    },
  });
  const treeLookup = new CachedTreeLookup(async () => {
    const request = computed?.();
    const response = await fetchLookupTree(
      tableName,
      request?.fields,
      narrowing,
    );
    if (response.computed) request?.store(response.computed);
    return response.entries;
  });
  return {
    valueLookup: new CachedValueLookup<LookupValue, Row>({
      loadEntriesForValues: async (values) => {
        // The server takes at most MAX_LOOKUP_IDS ids per lookup, and a
        // reload asks for every cached entry at once.
        const entries: LookupEntry<LookupValue, Row>[] = [];
        for (let start = 0; start < values.length; start += MAX_LOOKUP_IDS) {
          const request = computed?.();
          const response = await fetchLookup(
            tableName,
            values.slice(start, start + MAX_LOOKUP_IDS),
            request?.fields,
          );
          if (response.computed) request?.store(response.computed);
          entries.push(...response.entries);
        }
        return entries;
      },
    }),
    searchLookup:
      search === "client"
        ? new TreeSearchLookup(treeLookup, serverSearch)
        : serverSearch,
    treeLookup,
  };
}
