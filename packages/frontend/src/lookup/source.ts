import {
  CachedSearchLookup,
  CachedValueLookup,
  type LookupEntry,
  type LookupValue,
  type SearchLookup,
  type ValueLookup,
} from "@sapporta/grid/lookup";
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
  searchLookup: CachedSearchLookup<LookupValue, Row>;
  treeLookup: CachedTreeLookup;
};

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

export function createTableLookupSource(
  tableName: string,
  /** Called as each lookup is sent. */
  computed?: () => LookupComputedRequest,
  /** Narrows the search; lookups by id are never narrowed. */
  narrowing?: LookupNarrowing,
): CachedTableLookupSource {
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
    searchLookup: new CachedSearchLookup<LookupValue, Row>({
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
    }),
    treeLookup: new CachedTreeLookup(async () => {
      const request = computed?.();
      const response = await fetchLookupTree(
        tableName,
        request?.fields,
        narrowing,
      );
      if (response.computed) request?.store(response.computed);
      return response.entries;
    }),
  };
}
