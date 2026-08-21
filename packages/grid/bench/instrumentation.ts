import type {
  GridDataSource,
  LevelDataSource,
} from "../src/core/data-sources/types";
import type { GridEvents } from "../src/core/runtime/emitter";
import type { GridRuntime } from "../src/core/runtime/runtime";

export type BenchCounters = {
  rootSourceCalls: number;
  resolveChildCalls: number;
  sourceStateCalls: number;
  sourceSubscribeCalls: number;
  sourceSubscriberFires: number;
  sourceDisposeCalls: number;
  sourceSetCellCalls: number;
  sourceApplyChangesCalls: number;
  sourceCreateNodeCalls: number;
  sourceRemoveNodeCalls: number;
  reconcileSubscribeCalls: number;
  reconcileSubscriberFires: number;
  runtimeDisplayedSequenceSubscribes: number;
  runtimeDisplayedSequenceFires: number;
  runtimeDisplayedRowSubscribes: number;
  runtimeDisplayedRowFires: number;
  runtimeActiveRowSubscribes: number;
  runtimeActiveRowFires: number;
  runtimeSelectedRowSubscribes: number;
  runtimeSelectedRowFires: number;
  runtimeRowInteractionSubscribes: number;
  runtimeRowInteractionFires: number;
  hostMutationCommittedEvents: number;
  hostCellSelectionChangedEvents: number;
  hostRowSelectionChangedEvents: number;
  hostCellReconciledEvents: number;
  hostLevelStatusChangedEvents: number;
  hostPhantomRowCommittedEvents: number;
  hostPhantomRowCreateFailedEvents: number;
  hostCellActivationErrorEvents: number;
};

export function createBenchCounters(): BenchCounters {
  return {
    rootSourceCalls: 0,
    resolveChildCalls: 0,
    sourceStateCalls: 0,
    sourceSubscribeCalls: 0,
    sourceSubscriberFires: 0,
    sourceDisposeCalls: 0,
    sourceSetCellCalls: 0,
    sourceApplyChangesCalls: 0,
    sourceCreateNodeCalls: 0,
    sourceRemoveNodeCalls: 0,
    reconcileSubscribeCalls: 0,
    reconcileSubscriberFires: 0,
    runtimeDisplayedSequenceSubscribes: 0,
    runtimeDisplayedSequenceFires: 0,
    runtimeDisplayedRowSubscribes: 0,
    runtimeDisplayedRowFires: 0,
    runtimeActiveRowSubscribes: 0,
    runtimeActiveRowFires: 0,
    runtimeSelectedRowSubscribes: 0,
    runtimeSelectedRowFires: 0,
    runtimeRowInteractionSubscribes: 0,
    runtimeRowInteractionFires: 0,
    hostMutationCommittedEvents: 0,
    hostCellSelectionChangedEvents: 0,
    hostRowSelectionChangedEvents: 0,
    hostCellReconciledEvents: 0,
    hostLevelStatusChangedEvents: 0,
    hostPhantomRowCommittedEvents: 0,
    hostPhantomRowCreateFailedEvents: 0,
    hostCellActivationErrorEvents: 0,
  };
}

export function instrumentGridDataSource(
  source: GridDataSource,
  counters: BenchCounters,
): GridDataSource {
  return {
    rootSource() {
      counters.rootSourceCalls++;
      return instrumentLevelDataSource(source.rootSource(), counters);
    },
    resolveChild(parentPath, parentRowKey, childLevelName) {
      counters.resolveChildCalls++;
      return instrumentLevelDataSource(
        source.resolveChild(parentPath, parentRowKey, childLevelName),
        counters,
      );
    },
    dispose() {
      source.dispose();
    },
  };
}

export function eventCounters(counters: BenchCounters): {
  [E in keyof GridEvents]: (payload: GridEvents[E]) => void;
} {
  return {
    mutationCommitted: () => {
      counters.hostMutationCommittedEvents++;
    },
    cellSelectionChanged: () => {
      counters.hostCellSelectionChangedEvents++;
    },
    rowSelectionChanged: () => {
      counters.hostRowSelectionChangedEvents++;
    },
    cellReconciled: () => {
      counters.hostCellReconciledEvents++;
    },
    levelStatusChanged: () => {
      counters.hostLevelStatusChangedEvents++;
    },
    phantomRowCommitted: () => {
      counters.hostPhantomRowCommittedEvents++;
    },
    phantomRowCreateFailed: () => {
      counters.hostPhantomRowCreateFailedEvents++;
    },
    cellActivationError: () => {
      counters.hostCellActivationErrorEvents++;
    },
  };
}

export function attachRuntimeSubscribers(
  runtime: GridRuntime,
  counters: BenchCounters,
): () => void {
  const unsubs: Array<() => void> = [];
  for (const level of runtime.registeredLevels()) {
    counters.runtimeDisplayedSequenceSubscribes++;
    unsubs.push(
      level.subscribeDisplayedRowSequence(() => {
        counters.runtimeDisplayedSequenceFires++;
      }),
    );
    counters.runtimeActiveRowSubscribes++;
    unsubs.push(
      level.subscribeActiveRow(() => {
        counters.runtimeActiveRowFires++;
      }),
    );
    counters.runtimeSelectedRowSubscribes++;
    unsubs.push(
      level.subscribeSelectedRowIds(() => {
        counters.runtimeSelectedRowFires++;
      }),
    );
    counters.runtimeRowInteractionSubscribes++;
    unsubs.push(
      level.subscribeRowInteractionSnapshot(() => {
        counters.runtimeRowInteractionFires++;
      }),
    );
    for (const row of level.displayedRowSequence().rows) {
      counters.runtimeDisplayedRowSubscribes++;
      unsubs.push(
        level.subscribeDisplayedRow(row.id, () => {
          counters.runtimeDisplayedRowFires++;
        }),
      );
    }
  }
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

function instrumentLevelDataSource(
  source: LevelDataSource,
  counters: BenchCounters,
): LevelDataSource {
  const instrumented: LevelDataSource = {
    state() {
      counters.sourceStateCalls++;
      return source.state();
    },
    subscribe(fn) {
      counters.sourceSubscribeCalls++;
      return source.subscribe(() => {
        counters.sourceSubscriberFires++;
        fn();
      });
    },
    dispose() {
      counters.sourceDisposeCalls++;
      source.dispose();
    },
  };

  const sourceQuery = source.query;
  if (sourceQuery) {
    const query: NonNullable<LevelDataSource["query"]> = {};
    if (sourceQuery.sort) {
      const sort = sourceQuery.sort;
      query.sort = {
        current: () => sort.current(),
        set: (nextSort) => sort.set(nextSort),
      };
    }
    if (sourceQuery.filter) {
      const filter = sourceQuery.filter;
      query.filter = {
        current: () => filter.current(),
        set: (nextFilter) => filter.set(nextFilter),
      };
    }
    if (sourceQuery.refetch) {
      const refetch = sourceQuery.refetch;
      query.refetch = () => refetch();
    }
    if (query.sort || query.filter || query.refetch) {
      instrumented.query = query;
    }
  }

  const sourceWrite = source.write;
  if (sourceWrite) {
    instrumented.write = {
      setCell(rowKey, colId, value) {
        counters.sourceSetCellCalls++;
        sourceWrite.setCell(rowKey, colId, value);
      },
      applyChanges(changes) {
        counters.sourceApplyChangesCalls++;
        sourceWrite.applyChanges(changes);
      },
      createNode(node, atIndex) {
        counters.sourceCreateNodeCalls++;
        return sourceWrite.createNode(node, atIndex);
      },
      removeNode(rowKey) {
        counters.sourceRemoveNodeCalls++;
        return sourceWrite.removeNode(rowKey);
      },
      onReconcile(fn) {
        counters.reconcileSubscribeCalls++;
        return sourceWrite.onReconcile((event) => {
          counters.reconcileSubscriberFires++;
          fn(event);
        });
      },
      ...(sourceWrite.canAppendRow
        ? { canAppendRow: () => sourceWrite.canAppendRow!() }
        : {}),
    };
  }

  return instrumented;
}
