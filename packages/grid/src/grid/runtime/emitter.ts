// Emitters — how the grid talks to host code.
//
// Host callbacks (mutationCommitted, cellSelectionChanged, rowSelectionChanged,
// cellReconciled, levelStatusChanged, phantomRowCommitted,
// phantomRowCreateFailed) are wired via
// `runtime.on(...)` at runtime construction and torn down with `dispose()`.
// The runtime is created from a `RuntimeArgs` that includes initial
// subscriptions; React props are not the carrier.
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
//
// Selection events are domain-specific. There is no generic
// `selectionChanged`, because the grid has two unrelated selection concepts:
// a rectangular cell range and row operation targets.

import type { Coord, GridPath, RowKey } from "../types/identity";
import type { LevelStatus, ReconcileEvent } from "../data-sources/types";
import type { TreeNode } from "../types/level-row";
import type { CellSelectionState } from "../types/selection";
import type { RowSelection } from "../types/row-selection";
import type { CellActivationTrigger } from "../types/schema";
import {
  createObserverList,
  type ObserverErrorReporter,
  type ObserverList,
} from "../observer-notification";

export type MutationCommittedEvent =
  | {
      readonly kind: "cell";
      readonly path: GridPath;
      readonly coord: Coord;
      readonly oldValue: unknown;
      readonly newValue: unknown;
    }
  | {
      readonly kind: "cells";
      readonly path: GridPath;
      readonly edits: ReadonlyArray<{
        readonly coord: Coord;
        readonly oldValue: unknown;
        readonly newValue: unknown;
      }>;
    }
  | {
      readonly kind: "insert";
      readonly path: GridPath;
      readonly node: TreeNode;
      readonly atIndex: number;
    }
  | {
      readonly kind: "remove";
      readonly path: GridPath;
      readonly node: TreeNode;
      readonly atIndex: number;
    };

// Events emitted by the runtime to host code.
export type GridEvents = {
  mutationCommitted: MutationCommittedEvent;
  cellSelectionChanged: {
    readonly path: GridPath;
    readonly selection: CellSelectionState | null;
  };
  rowSelectionChanged: {
    readonly path: GridPath;
    readonly selection: RowSelection;
  };
  // Reconciliation result for an optimistic edit. The path identifies the
  // source that emitted the event; the inner `event` is the source's own
  // ReconcileEvent (`agreed` | `diverged` | `rejected`). Wrapped rather
  // than spread to keep `path` from colliding with future ReconcileEvent
  // fields.
  cellReconciled: {
    readonly path: GridPath;
    readonly event: ReconcileEvent;
  };
  // Source status transitions — fires on every transition observed by the
  // runtime's source subscription.
  levelStatusChanged: {
    readonly path: GridPath;
    readonly status: LevelStatus;
    readonly error?: Error;
  };
  phantomRowCommitted: {
    readonly path: GridPath;
    readonly rowKey: RowKey;
    readonly node: TreeNode;
    readonly atIndex: number;
  };
  phantomRowCreateFailed: {
    readonly path: GridPath;
    readonly rowKey: RowKey;
    readonly reason: string;
  };
  cellActivationError: {
    readonly path: GridPath;
    readonly coord: Coord;
    readonly trigger: CellActivationTrigger;
    readonly error: unknown;
  };
};

type EventName = keyof GridEvents;
type Handler<E extends EventName> = (payload: GridEvents[E]) => void;

export type GridEmitter = {
  on: <E extends EventName>(event: E, handler: Handler<E>) => () => void;
  emit: <E extends EventName>(event: E, payload: GridEvents[E]) => void;
  clear: () => void;
};

type AnyHandler = (payload: GridEvents[EventName]) => void;
type EventObserverList = ObserverList<[payload: GridEvents[EventName]]>;

export function createEmitter(
  onObserverError?: ObserverErrorReporter,
): GridEmitter {
  // Storage is keyed loosely; the public `on`/`emit` methods preserve
  // event-name typing through their generic parameter, and the per-event
  // observer list holds homogeneous payloads.
  const handlers = new Map<EventName, EventObserverList>();
  return {
    on<E extends EventName>(event: E, handler: Handler<E>): () => void {
      let observers = handlers.get(event);
      if (!observers) {
        observers = createObserverList(onObserverError);
        handlers.set(event, observers);
      }
      return observers.subscribe(handler as AnyHandler);
    },
    emit<E extends EventName>(event: E, payload: GridEvents[E]): void {
      handlers.get(event)?.notify(payload);
    },
    clear() {
      for (const observers of handlers.values()) observers.clear();
      handlers.clear();
    },
  };
}
