import type {
  GridDataSource,
  LevelDataSource,
  RuntimeLevelDataSource,
} from "../src/grid/data-sources/types";
import type { GridEvents } from "../src/grid/runtime/emitter";
import type { GridRuntime } from "../src/grid/runtime/create-grid-runtime";

export type BenchCounters = {
  rootSourceCalls: number;
  resolveChildCalls: number;
  sourceSnapshotCalls: number;
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
};

export function createBenchCounters(): BenchCounters {
  return {
    rootSourceCalls: 0,
    resolveChildCalls: 0,
    sourceSnapshotCalls: 0,
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
  };
}

export function attachRuntimeSubscribers(
  runtime: GridRuntime,
  counters: BenchCounters,
): () => void {
  const unsubs: Array<() => void> = [];
  for (const path of runtime.registeredPaths()) {
    counters.runtimeDisplayedSequenceSubscribes++;
    unsubs.push(
      runtime.subscribeDisplayedRowSequence(path, () => {
        counters.runtimeDisplayedSequenceFires++;
      }),
    );
    counters.runtimeActiveRowSubscribes++;
    unsubs.push(
      runtime.subscribeActiveRow(path, () => {
        counters.runtimeActiveRowFires++;
      }),
    );
    counters.runtimeSelectedRowSubscribes++;
    unsubs.push(
      runtime.subscribeSelectedRowIds(path, () => {
        counters.runtimeSelectedRowFires++;
      }),
    );
    counters.runtimeRowInteractionSubscribes++;
    unsubs.push(
      runtime.subscribeRowInteractionSnapshot(path, () => {
        counters.runtimeRowInteractionFires++;
      }),
    );
    for (const row of runtime.displayedRowSequenceFor(path).rows) {
      counters.runtimeDisplayedRowSubscribes++;
      unsubs.push(
        runtime.subscribeDisplayedRow(path, row.id, () => {
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
  const read: RuntimeLevelDataSource = {
    writable: source.writable,
    snapshot() {
      counters.sourceSnapshotCalls++;
      return source.snapshot();
    },
    subscribe(fn) {
      counters.sourceSubscribeCalls++;
      return source.subscribe(() => {
        counters.sourceSubscriberFires++;
        fn();
      });
    },
    setSort(sort) {
      source.setSort(sort);
    },
    setFilter(filter) {
      source.setFilter(filter);
    },
    setPage(page, pageSize) {
      source.setPage(page, pageSize);
    },
    refetch() {
      source.refetch();
    },
    onReconcile(fn) {
      counters.reconcileSubscribeCalls++;
      if (!source.writable) return () => {};
      return source.onReconcile((event) => {
        counters.reconcileSubscriberFires++;
        fn(event);
      });
    },
  };

  if (!source.writable) {
    return {
      ...read,
      writable: false,
      dispose() {
        counters.sourceDisposeCalls++;
        source.dispose();
      },
    };
  }

  return {
    ...read,
    writable: true,
    setCell(rowKey, colId, value) {
      counters.sourceSetCellCalls++;
      source.setCell(rowKey, colId, value);
    },
    applyChanges(changes) {
      counters.sourceApplyChangesCalls++;
      source.applyChanges(changes);
    },
    createNode(node, atIndex) {
      counters.sourceCreateNodeCalls++;
      return source.createNode(node, atIndex);
    },
    removeNode(rowKey) {
      counters.sourceRemoveNodeCalls++;
      source.removeNode(rowKey);
    },
    dispose() {
      counters.sourceDisposeCalls++;
      source.dispose();
    },
  };
}
