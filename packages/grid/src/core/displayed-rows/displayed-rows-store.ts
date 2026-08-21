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
import {
  createObserverList,
  type ObserverErrorReporter,
  type ObserverList,
} from "../observer-notification";

export type CreateDisplayedRowsStoreArgs = {
  readInput(): DisplayedRowsInput;
  deriveDisplayedRowsState(
    input: DisplayedRowsInput,
    previous?: DisplayedRowsState,
  ): DisplayedRowsState;
  beforeNotify?: () => void;
  onObserverError?: ObserverErrorReporter;
};

export type DisplayedRowsStore = {
  getDisplayedRows(): DisplayedRows;
  getDisplayedRowSequence(): DisplayedRowSequence;
  getDisplayedRow(rowId: RowId): LevelRow | undefined;
  invalidateDisplayedRows(reason: DisplayedRowsInvalidationReason): void;
  /**
   * Observes the complete displayed-row value.
   *
   * Use this when a result depends on several visible rows, such as a selected
   * range summary. Row rendering should use the narrower sequence and
   * single-row subscriptions instead.
   */
  subscribeDisplayedRows(fn: () => void): () => void;
  subscribeDisplayedRowSequence(fn: () => void): () => void;
  subscribeDisplayedRow(rowId: RowId, fn: () => void): () => void;
  dispose(): void;
};

// External store for exactly one grid path's body read model.
//
// The store owns cached full-row and row-sequence snapshots plus three
// subscription surfaces:
//   - full-row subscribers care about the complete displayed-row snapshot;
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
  const displayedRowsSubscribers = createObserverList<[]>(args.onObserverError);
  const displayedRowSequenceSubscribers = createObserverList<[]>(
    args.onObserverError,
  );
  const displayedRowSubscribersById = new Map<RowId, ObserverList<[]>>();
  let disposed = false;

  function notifyDisplayedRowSequenceSubscribers(): void {
    displayedRowSequenceSubscribers.notify();
  }

  function notifyDisplayedRowSubscribers(rowId: RowId): void {
    displayedRowSubscribersById.get(rowId)?.notify();
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
      if (disposed) return;
      const previous = current;
      const next = args.deriveDisplayedRowsState(args.readInput(), previous);
      current = next;
      args.beforeNotify?.();

      if (previous.displayedRows !== next.displayedRows) {
        displayedRowsSubscribers.notify();
      }

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
    subscribeDisplayedRows(fn) {
      if (disposed) return () => {};
      return displayedRowsSubscribers.subscribe(fn);
    },
    subscribeDisplayedRowSequence(fn) {
      if (disposed) return () => {};
      return displayedRowSequenceSubscribers.subscribe(fn);
    },
    subscribeDisplayedRow(rowId, fn) {
      if (disposed) return () => {};
      let observers = displayedRowSubscribersById.get(rowId);
      if (!observers) {
        observers = createObserverList(args.onObserverError);
        displayedRowSubscribersById.set(rowId, observers);
      }
      const unsubscribe = observers.subscribe(fn);
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        unsubscribe();
        if (observers.size() === 0) displayedRowSubscribersById.delete(rowId);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      displayedRowsSubscribers.clear();
      displayedRowSequenceSubscribers.clear();
      for (const observers of displayedRowSubscribersById.values()) {
        observers.clear();
      }
      displayedRowSubscribersById.clear();
    },
  };
}
