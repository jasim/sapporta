// Emitters — how the grid talks to host code.
//
// Host callbacks (mutationCommitted, selectionChanged, cellReconciled,
// levelStatusChanged, phantomCommitted) are wired via `runtime.on(...)` at
// runtime construction and torn down with `dispose()`. The runtime is created
// from a `RuntimeArgs` that includes initial subscriptions; React props are not
// the carrier.
//
// Why not callback props? React consumers whose handler identities change
// on every render would churn subscriptions if they were wired through
// props. The emitter pattern keeps a single subscription alive for the
// runtime's lifetime.
//
// Event structure for `cellReconciled`: the ReconcileEvent is wrapped as
// `{ path, event: ReconcileEvent }` rather than spread into the payload,
// to avoid key collisions between `path` and future ReconcileEvent fields.
//
// `mutationCommitted` is the user-attributable mutation stream. It fires
// iff a runtime write verb was invoked. Source-internal mutations such as
// refetches, authoritative reconcile updates, and atomic rollbacks are data
// updates only; they flow through source subscriptions and never emit this
// event.

import type { Coord, GridPath, RowKey } from "../types/identity";
import type { LevelStatus, ReconcileEvent } from "../data-sources/types";
import type { TreeNode } from "../types/level-row";
import type { SelectionState } from "../types/selection";

export type MutationCommittedEvent =
  | {
      kind: "cell";
      path: GridPath;
      coord: Coord;
      oldValue: unknown;
      newValue: unknown;
    }
  | {
      kind: "cells";
      path: GridPath;
      edits: ReadonlyArray<{
        coord: Coord;
        oldValue: unknown;
        newValue: unknown;
      }>;
    }
  | { kind: "insert"; path: GridPath; node: TreeNode; atIndex: number }
  | { kind: "remove"; path: GridPath; node: TreeNode; atIndex: number };

// Events emitted by the runtime to host code.
export type GridEvents = {
  mutationCommitted: MutationCommittedEvent;
  selectionChanged: { path: GridPath; selection: SelectionState | null };
  // Reconciliation result for an optimistic edit. The path identifies the
  // source that emitted the event; the inner `event` is the source's own
  // ReconcileEvent (`agreed` | `diverged` | `rejected`). Wrapped rather
  // than spread to keep `path` from colliding with future ReconcileEvent
  // fields.
  cellReconciled: { path: GridPath; event: ReconcileEvent };
  // Source status transitions — fires on every transition observed by the
  // runtime's source subscription.
  levelStatusChanged: { path: GridPath; status: LevelStatus; error?: Error };
  // A phantom row at `path` was promoted into a real node via the
  // host-orchestrated commit (insertNode + phantom remove).
  phantomCommitted: { path: GridPath; rowKey: RowKey };
};

type EventName = keyof GridEvents;
type Handler<E extends EventName> = (payload: GridEvents[E]) => void;

export type GridEmitter = {
  on: <E extends EventName>(event: E, handler: Handler<E>) => () => void;
  emit: <E extends EventName>(event: E, payload: GridEvents[E]) => void;
  clear: () => void;
};

type AnyHandler = (payload: GridEvents[EventName]) => void;

export function createEmitter(): GridEmitter {
  // Storage is keyed loosely; the public `on`/`emit` methods preserve
  // event-name typing through their generic parameter, and the per-event
  // handler set holds homogeneous payloads.
  const handlers = new Map<EventName, Set<AnyHandler>>();
  return {
    on<E extends EventName>(event: E, handler: Handler<E>): () => void {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      const h = handler as AnyHandler;
      set.add(h);
      return () => {
        set!.delete(h);
      };
    },
    emit<E extends EventName>(event: E, payload: GridEvents[E]): void {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of set) (h as Handler<E>)(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}
