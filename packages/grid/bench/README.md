# Grid Benchmarks

The `bench` directory contains headless runtime benchmarks for
`@sapporta/grid`. The package build reads production modules from `src`. The
benchmark runner reads its datasets and instrumentation from this directory.
Each generated `TreeNode` carries a stable path-derived `rowKey`.

## Runtime Benchmarks

Run the headless runtime suite:

```bash
pnpm --filter @sapporta/grid bench:runtime:gc -- --dataset regular
```

Emit JSON for plotting or regression checks:

```bash
pnpm --filter @sapporta/grid bench:runtime:gc -- --dataset medium --bench interaction.commitCell --format json
```

Available datasets:

- `regular`
- `medium`
- `large`
- `wideFlat`
- `deepTree`
- `all`

Available benchmarks:

- `memory.runtime.flat`
- `memory.runtime.treeAllExpanded`
- `memory.cleanup`
- `interaction.moveCell`
- `interaction.moveCellCrossPath`
- `interaction.selectCellRange`
- `interaction.rowSelection`
- `interaction.startCancelEdit`
- `interaction.commitCell`
- `data.rederive`
- `expansion.lifecycle`
- `all`

## What This Measures

The runtime harness measures the headless state graph:

- registered level count and source subscription fanout
- displayed-row sequence and per-row subscription fanout
- row interaction subscription fanout
- mutation/status/reconcile host event counts
- heap delta with forced GC when run through `bench:runtime:gc`
- elapsed operation time

Each result separates setup and action cost:

- `timingsMs.datasetBuild`: schema/tree fixture construction
- `timingsMs.runtimeCreate`: `createGridRuntime(...)`
- `timingsMs.expand`: root, branch, or all-tree expansion work performed before
  the action
- `timingsMs.touchDisplayed`: displayed-row/sequence derivation reads
- `timingsMs.attachSubscribers`: benchmark subscriber fanout setup
- `timingsMs.action`: the operation the benchmark is named after
- `timingsMs.countDisplayed`: final registered-level and row counting
- `timingsMs.detachSubscribers` and `timingsMs.runtimeDispose`: teardown work
- `timingsMs.measuredWork`: setup, action, and counting phases summed without
  forced-GC checkpoint time
- `timingsMs.wallClock`: end-to-end wall time including forced-GC checkpoints

The JSON `memoryMb` object is a forced-GC heap profile in MB:

- `baseline`: heap before building the fixture
- `afterDatasetBuild`: heap while only the benchmark dataset is live
- `afterRuntimeCreate`, `afterExpand`, `afterTouchDisplayed`, and
  `afterAttachSubscribers`: setup-phase heap checkpoints
- `liveAfterAction`: heap while the dataset, runtime, and benchmark subscribers
  are still live
- `afterDetach`: heap after benchmark subscribers are removed
- `afterRuntimeDispose`: heap after `runtime.dispose()`
- `afterDatasetRelease`: heap after the benchmark drops its dataset reference
- `retainedDelta`: `afterDatasetRelease - baseline`, useful as a leak smoke test

The harness imports the runtime and advanced composition modules directly. A
separate browser fixture can measure React fiber, DOM, layout, paint, and
browser heap costs.
