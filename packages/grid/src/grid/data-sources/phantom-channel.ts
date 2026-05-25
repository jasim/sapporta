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

// Returned by `get` for any path with no phantoms. Module-scoped so the
// reference is stable across calls and across channel instances; displayed-row
// derivation identity preservation treats this as the "no phantoms" sentinel.
const EMPTY: PhantomRow[] = [];

export function createPhantomChannel(initial?: Map<GridPath, PhantomRow[]>): PhantomChannel {
  const byPath = new Map<GridPath, PhantomRow[]>();
  if (initial) {
    for (const [path, arr] of initial) {
      if (arr.length > 0) byPath.set(path, arr);
    }
  }

  const subs = new Map<GridPath, Set<() => void>>();

  function notify(path: GridPath): void {
    const set = subs.get(path);
    if (!set) return;
    for (const fn of set) fn();
  }

  return {
    get(path) {
      return byPath.get(path) ?? EMPTY;
    },
    add(path, phantom) {
      const cur = byPath.get(path) ?? EMPTY;
      const idx = cur.findIndex((p) => p.rowKey === phantom.rowKey);
      const next = cur.slice();
      // Match the prior runtime behavior: a colliding rowKey replaces the
      // existing phantom rather than inserting a duplicate.
      if (idx >= 0) next[idx] = phantom;
      else next.push(phantom);
      byPath.set(path, next);
      notify(path);
    },
    remove(path, rowKey) {
      const cur = byPath.get(path);
      if (!cur) return;
      const idx = cur.findIndex((p) => p.rowKey === rowKey);
      if (idx < 0) return;
      const next = cur.slice();
      next.splice(idx, 1);
      // Evict on last-remove so `get` falls back to the EMPTY sentinel.
      if (next.length === 0) byPath.delete(path);
      else byPath.set(path, next);
      notify(path);
    },
    setCell(path, rowKey, colId, value) {
      const cur = byPath.get(path);
      if (!cur) return;
      const idx = cur.findIndex((p) => p.rowKey === rowKey);
      if (idx < 0) return;
      const old = cur[idx];
      const updated: PhantomRow = {
        ...old,
        columns: { ...old.columns, [colId]: value },
      };
      const next = cur.slice();
      next[idx] = updated;
      byPath.set(path, next);
      notify(path);
    },
    subscribe(path, fn) {
      let set = subs.get(path);
      if (!set) {
        set = new Set();
        subs.set(path, set);
      }
      set.add(fn);
      return () => {
        const s = subs.get(path);
        if (!s) return;
        s.delete(fn);
        if (s.size === 0) subs.delete(path);
      };
    },
  };
}
