// Author-state phantom rows, kept on a per-path channel separate from the
// data plane. Sources never see phantoms (data invariant 6 — see
// `data/types.ts`); the runtime's displayed-rows store reads them as part of
// the path's complete `DisplayedRowsInput`.
//
// Hand-rolled rather than Zustand: subscriptions here are per-path, and a
// change to path A must NOT notify path B's subscribers. The runtime wires one
// phantom subscription per displayed-rows store so only the affected path
// invalidates. Zustand's vanilla store is one-store-many-subscribers without a
// natural per-key seam; mapping per-path subscriptions onto it would mean a
// selector-with-equality dance that ends up doing more bookkeeping than a
// small `Map<path, Set<fn>>`. The grid-controller and grid-coordinator stores
// remain Zustand because their subscribers care about whole-store transitions.
//
// `subscribe` carries no payload — consumers re-read `get(path)` after
// the callback fires. `dispose` does NOT fire pending subscribers (clean
// teardown — the source is expected to drop its subscriber list on dispose
// rather than emit a final synthetic event).

import type { ColId, GridPath, RowKey } from "../types/identity";
import type { PhantomRow } from "../types/level-row";
import type { PhantomChannel } from "./types";
import {
  createObserverList,
  type ObserverErrorReporter,
  type ObserverList,
} from "../observer-notification";

// Returned by `get` for any path with no phantoms. Module-scoped so the
// reference is stable across calls and across channel instances; displayed-row
// derivation identity preservation treats this as the "no phantoms" sentinel.
const EMPTY: readonly PhantomRow[] = [];
const internalsByChannel = new WeakMap<
  PhantomChannel,
  { disposePath(path: GridPath): void }
>();

export function disposePhantomPath(
  channel: PhantomChannel,
  path: GridPath,
): void {
  internalsByChannel.get(channel)?.disposePath(path);
}

export function createPhantomChannel(
  initial?: ReadonlyMap<GridPath, readonly PhantomRow[]>,
  onObserverError?: ObserverErrorReporter,
): PhantomChannel {
  const byPath = new Map<GridPath, readonly PhantomRow[]>();
  if (initial) {
    for (const [path, rows] of initial) {
      assertUniqueDraftKeys(path, rows);
      if (rows.length > 0) byPath.set(path, rows);
    }
  }

  const subscribers = new Map<GridPath, ObserverList<[]>>();
  let disposed = false;

  function notify(path: GridPath): void {
    subscribers.get(path)?.notify();
  }

  function get(path: GridPath): readonly PhantomRow[] {
    if (disposed) return EMPTY;
    return byPath.get(path) ?? EMPTY;
  }

  function add(path: GridPath, phantom: PhantomRow): void {
    if (disposed) return;
    const current = byPath.get(path) ?? EMPTY;
    assertDraftKeyAvailable(path, phantom.rowKey, current);
    byPath.set(path, [...current, phantom]);
    notify(path);
  }

  function remove(path: GridPath, rowKey: RowKey): void {
    if (disposed) return;
    const current = byPath.get(path);
    if (!current) return;
    const index = current.findIndex((phantom) => phantom.rowKey === rowKey);
    if (index < 0) return;
    const next = current.slice();
    next.splice(index, 1);
    // Evict on last-remove so `get` falls back to the EMPTY sentinel.
    if (next.length === 0) byPath.delete(path);
    else byPath.set(path, next);
    notify(path);
  }

  function update(
    path: GridPath,
    rowKey: RowKey,
    apply: (row: PhantomRow) => PhantomRow,
  ): void {
    if (disposed) return;
    const current = byPath.get(path);
    if (!current) return;
    const index = current.findIndex((phantom) => phantom.rowKey === rowKey);
    if (index < 0) return;
    const updated = apply(current[index]);
    assertDraftKeyAvailable(path, updated.rowKey, current, index);
    const next = current.slice();
    next[index] = updated;
    byPath.set(path, next);
    notify(path);
  }

  function subscribe(path: GridPath, fn: () => void): () => void {
    if (disposed) return () => {};
    let observers = subscribers.get(path);
    if (!observers) {
      observers = createObserverList(onObserverError);
      subscribers.set(path, observers);
    }
    const unsubscribe = observers.subscribe(fn);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      unsubscribe();
      if (observers.size() === 0) subscribers.delete(path);
    };
  }

  const channel: PhantomChannel = {
    get,
    add,
    remove,
    setCell(path, rowKey, colId, value) {
      update(path, rowKey, (old) => ({
        ...old,
        columns: { ...old.columns, [colId]: value },
      }));
    },
    setState(path, rowKey, state) {
      update(path, rowKey, (old) => ({ ...old, state }));
    },
    update,
    subscribe,
    dispose() {
      if (disposed) return;
      disposed = true;
      byPath.clear();
      for (const observers of subscribers.values()) observers.clear();
      subscribers.clear();
    },
  };
  internalsByChannel.set(channel, {
    disposePath(path) {
      byPath.delete(path);
      subscribers.get(path)?.clear();
      subscribers.delete(path);
    },
  });
  return channel;
}

function assertUniqueDraftKeys(
  path: GridPath,
  rows: readonly PhantomRow[],
): void {
  const seen = new Set<RowKey>();
  for (const row of rows) {
    assertNonemptyDraftKey(path, row.rowKey);
    if (seen.has(row.rowKey)) throw duplicateDraftKeyError(path, row.rowKey);
    seen.add(row.rowKey);
  }
}

function assertDraftKeyAvailable(
  path: GridPath,
  rowKey: RowKey,
  rows: readonly PhantomRow[],
  currentIndex = -1,
): void {
  assertNonemptyDraftKey(path, rowKey);
  const duplicate = rows.some(
    (row, index) => index !== currentIndex && row.rowKey === rowKey,
  );
  if (duplicate) throw duplicateDraftKeyError(path, rowKey);
}

function assertNonemptyDraftKey(path: GridPath, rowKey: RowKey): void {
  if (rowKey.length === 0) {
    throw new Error(
      `PhantomChannel: draft rowKey must not be empty at path "${path}".`,
    );
  }
}

function duplicateDraftKeyError(path: GridPath, rowKey: RowKey): Error {
  return new Error(
    `PhantomChannel: duplicate draft rowKey "${rowKey}" at path "${path}".`,
  );
}
