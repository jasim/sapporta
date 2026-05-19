import type { RowId } from "../types/identity";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  LevelRow,
} from "../types/level-row";
import type {
  DisplayedRowsInput,
  DisplayedRowsInvalidationReason,
  DisplayedRowsState,
} from "./types";

export type CreateDisplayedRowsStoreArgs = {
  readInput(): DisplayedRowsInput;
  deriveDisplayedRowsState(
    input: DisplayedRowsInput,
    previous?: DisplayedRowsState,
  ): DisplayedRowsState;
};

export type DisplayedRowsStore = {
  getDisplayedRows(): DisplayedRows;
  getDisplayedRowSequence(): DisplayedRowSequence;
  getDisplayedRow(rowId: RowId): LevelRow | undefined;
  invalidateDisplayedRows(reason: DisplayedRowsInvalidationReason): void;
  subscribeDisplayedRowSequence(fn: () => void): () => void;
  subscribeDisplayedRow(rowId: RowId, fn: () => void): () => void;
  dispose(): void;
};

// External store for exactly one grid path's body read model.
//
// The store owns cached full-row and row-sequence snapshots plus two
// subscription surfaces:
//   - sequence subscribers care about the ordered row refs the body maps;
//   - row subscribers care about one `LevelRow` object by id.
//
// It does not know where data lives. On invalidation it asks `readInput` for
// the complete current recipe, runs the pure deriver, then compares object
// identities to decide which subscribers should wake. That keeps source,
// phantom, and future view-state changes on one path from leaking into React
// components that only care about another path or another row.
export function createDisplayedRowsStore(
  args: CreateDisplayedRowsStoreArgs,
): DisplayedRowsStore {
  let current = args.deriveDisplayedRowsState(args.readInput(), undefined);
  const displayedRowSequenceSubscribers = new Set<() => void>();
  const displayedRowSubscribersById = new Map<RowId, Set<() => void>>();

  function notifyDisplayedRowSequenceSubscribers(): void {
    for (const fn of Array.from(displayedRowSequenceSubscribers)) fn();
  }

  function notifyDisplayedRowSubscribers(rowId: RowId): void {
    const set = displayedRowSubscribersById.get(rowId);
    if (!set) return;
    for (const fn of Array.from(set)) fn();
  }

  return {
    getDisplayedRows() {
      return current.displayedRows;
    },
    getDisplayedRowSequence() {
      return current.displayedRowSequence;
    },
    getDisplayedRow(rowId) {
      return current.displayedRows.rowById.get(rowId);
    },
    invalidateDisplayedRows(_reason) {
      const previous = current;
      const next = args.deriveDisplayedRowsState(args.readInput(), previous);
      current = next;

      if (previous.displayedRowSequence !== next.displayedRowSequence) {
        notifyDisplayedRowSequenceSubscribers();
      }

      for (const rowId of Array.from(displayedRowSubscribersById.keys())) {
        if (
          previous.displayedRows.rowById.get(rowId) !==
          next.displayedRows.rowById.get(rowId)
        ) {
          notifyDisplayedRowSubscribers(rowId);
        }
      }
    },
    subscribeDisplayedRowSequence(fn) {
      displayedRowSequenceSubscribers.add(fn);
      return () => {
        displayedRowSequenceSubscribers.delete(fn);
      };
    },
    subscribeDisplayedRow(rowId, fn) {
      let set = displayedRowSubscribersById.get(rowId);
      if (!set) {
        set = new Set();
        displayedRowSubscribersById.set(rowId, set);
      }
      set.add(fn);
      return () => {
        const cur = displayedRowSubscribersById.get(rowId);
        if (!cur) return;
        cur.delete(fn);
        if (cur.size === 0) displayedRowSubscribersById.delete(rowId);
      };
    },
    dispose() {
      displayedRowSequenceSubscribers.clear();
      displayedRowSubscribersById.clear();
    },
  };
}
