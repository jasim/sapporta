import { performance } from "node:perf_hooks";
import {
  createGridRuntime,
  type GridRuntime,
} from "../src/core/runtime/runtime";
import type { GridLevelRuntime } from "../src/core/runtime/grid-level-runtime";
import { controllerFor, cursorManagerFor } from "../src/advanced";
import { inMemoryGridDataSource } from "../src/core/data-sources/memory/in-memory-grid-source";
import { childPath } from "../src/core/types/identity";
import { CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION } from "../src/core/types/interaction";
import type { RowId } from "../src/core/types/identity";
import {
  buildBenchDataset,
  type BenchDataset,
  datasetConfigFor,
  datasetNames,
  type BenchDatasetName,
} from "./datasets";
import {
  attachRuntimeSubscribers,
  createBenchCounters,
  eventCounters,
  instrumentGridDataSource,
  type BenchCounters,
} from "./instrumentation";

type BenchName =
  | "memory.runtime.flat"
  | "memory.runtime.treeAllExpanded"
  | "memory.cleanup"
  | "interaction.moveCell"
  | "interaction.moveCellCrossPath"
  | "interaction.selectCellRange"
  | "interaction.rowSelection"
  | "interaction.startCancelEdit"
  | "interaction.commitCell"
  | "data.rederive"
  | "expansion.lifecycle";

type BenchResult = {
  bench: BenchName;
  dataset: BenchDatasetName;
  nodeCount: number;
  pathCount: number;
  rowCount: number;
  durationMs: number;
  heapDeltaMb: number;
  heapAfterMb: number;
  timingsMs: PhaseTimings;
  memoryMb: MemoryProfile;
  counters: BenchCounters;
};

type PhaseTimings = {
  datasetBuild: number;
  runtimeCreate: number;
  expand: number;
  touchDisplayed: number;
  attachSubscribers: number;
  action: number;
  countDisplayed: number;
  detachSubscribers: number;
  runtimeDispose: number;
  measuredWork: number;
  wallClock: number;
};

type MemoryProfile = {
  baseline: number;
  afterDatasetBuild: number;
  datasetDelta: number;
  afterRuntimeCreate: number;
  afterExpand: number;
  afterTouchDisplayed: number;
  afterAttachSubscribers: number;
  liveAfterAction: number;
  liveDelta: number;
  afterDetach: number;
  afterRuntimeDispose: number;
  afterDatasetRelease: number;
  retainedDelta: number;
};

const BENCHES: BenchName[] = [
  "memory.runtime.flat",
  "memory.runtime.treeAllExpanded",
  "memory.cleanup",
  "interaction.moveCell",
  "interaction.moveCellCrossPath",
  "interaction.selectCellRange",
  "interaction.rowSelection",
  "interaction.startCancelEdit",
  "interaction.commitCell",
  "data.rederive",
  "expansion.lifecycle",
];

const args = parseArgs(process.argv.slice(2));
const selectedDatasets =
  args.dataset === "all" ? datasetNames() : [args.dataset];
const selectedBenches = args.bench === "all" ? BENCHES : [args.bench];
const results: BenchResult[] = [];

for (const dataset of selectedDatasets) {
  for (const bench of selectedBenches) {
    results.push(runBench(bench, dataset));
  }
}

if (args.format === "json") {
  process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
} else {
  printMarkdown(results);
}

function runBench(
  bench: BenchName,
  datasetName: BenchDatasetName,
): BenchResult {
  forceGc();
  const heapBefore = heapUsedMb();
  const totalStart = performance.now();
  const counters = createBenchCounters();
  let runtime: GridRuntime | null = null;
  let detachSubscribers: (() => void) | null = null;
  let pathCount = 0;
  let rowCount = 0;
  let dataset: BenchDataset | null = null;
  let nodeCount = 0;
  const timings = createPhaseTimings();
  const memory = createMemoryProfile(heapBefore);

  try {
    dataset = timePhase(timings, "datasetBuild", () =>
      bench === "memory.runtime.flat"
        ? buildBenchDataset({
            ...datasetConfigFor(datasetName),
            depth: 1,
            branching: 0,
          })
        : buildBenchDataset(datasetConfigFor(datasetName)),
    );
    nodeCount = dataset.expectedNodeCount;
    memory.afterDatasetBuild = measuredHeapUsedMb();
    memory.datasetDelta = roundMb(memory.afterDatasetBuild - heapBefore);

    runtime = timePhase(timings, "runtimeCreate", () =>
      createRuntime(datasetOrThrow(dataset), counters),
    );
    memory.afterRuntimeCreate = measuredHeapUsedMb();
    memory.afterExpand = memory.afterRuntimeCreate;
    memory.afterTouchDisplayed = memory.afterRuntimeCreate;
    memory.afterAttachSubscribers = memory.afterRuntimeCreate;
    switch (bench) {
      case "memory.runtime.flat":
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        break;
      case "memory.runtime.treeAllExpanded":
        expand(runtime, timings, () => expandAll(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        break;
      case "memory.cleanup":
        expand(runtime, timings, () => expandAll(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performCommitCell(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.moveCell":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performMoveCell(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.moveCellCrossPath":
        expand(runtime, timings, () =>
          expandFirstBranch(runtimeOrThrow(runtime)),
        );
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performMoveCellCrossPath(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.selectCellRange":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performSelectCellRange(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.rowSelection":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performRowSelection(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.startCancelEdit":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performStartCancelEdit(runtimeOrThrow(runtime)),
        );
        break;
      case "interaction.commitCell":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performCommitCell(runtimeOrThrow(runtime)),
        );
        break;
      case "data.rederive":
        expand(runtime, timings, () => expandRootOnly(runtimeOrThrow(runtime)));
        memory.afterExpand = measuredHeapUsedMb();
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        timePhase(timings, "action", () =>
          performDataRederive(runtimeOrThrow(runtime)),
        );
        break;
      case "expansion.lifecycle":
        timePhase(timings, "action", () =>
          performExpansionLifecycle(runtimeOrThrow(runtime)),
        );
        touchDisplayed(runtime, timings);
        memory.afterTouchDisplayed = measuredHeapUsedMb();
        detachSubscribers = attachSubscribers(runtime, counters, timings);
        memory.afterAttachSubscribers = measuredHeapUsedMb();
        break;
    }
    if (runtime) {
      const counts = timePhase(timings, "countDisplayed", () => ({
        paths: runtimeOrThrow(runtime).registeredLevels().length,
        rows: countDisplayedRows(runtimeOrThrow(runtime)),
      }));
      pathCount = counts.paths;
      rowCount = counts.rows;
    }
    memory.liveAfterAction = measuredHeapUsedMb();
    memory.liveDelta = roundMb(memory.liveAfterAction - heapBefore);
  } finally {
    if (detachSubscribers) {
      timePhase(timings, "detachSubscribers", () => detachSubscribers?.());
      detachSubscribers = null;
    }
    memory.afterDetach = measuredHeapUsedMb();
    if (runtime) {
      timePhase(timings, "runtimeDispose", () => runtime?.dispose());
      runtime = null;
    }
    memory.afterRuntimeDispose = measuredHeapUsedMb();
    dataset = null;
  }

  memory.afterDatasetRelease = measuredHeapUsedMb();
  memory.retainedDelta = roundMb(memory.afterDatasetRelease - heapBefore);
  const durationMs = performance.now() - totalStart;
  timings.measuredWork = roundMs(
    timings.datasetBuild +
      timings.runtimeCreate +
      timings.expand +
      timings.touchDisplayed +
      timings.attachSubscribers +
      timings.action +
      timings.countDisplayed,
  );
  timings.wallClock = roundMs(durationMs);
  return {
    bench,
    dataset: datasetName,
    nodeCount,
    pathCount,
    rowCount,
    durationMs,
    heapDeltaMb: memory.liveDelta,
    heapAfterMb: memory.liveAfterAction,
    timingsMs: timings,
    memoryMb: memory,
    counters,
  };
}

function createRuntime(
  dataset: ReturnType<typeof buildBenchDataset>,
  counters: BenchCounters,
): GridRuntime {
  return createGridRuntime({
    schema: dataset.schema,
    interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    dataSource: instrumentGridDataSource(
      inMemoryGridDataSource({
        schema: dataset.schema,
        tree: dataset.tree,
        levels: dataset.levels,
      }),
      counters,
    ),
    on: eventCounters(counters),
  });
}

function expandRootOnly(runtime: GridRuntime): void {
  runtime.root.displayedRows();
}

function expandFirstBranch(runtime: GridRuntime): void {
  const root = runtime.root;
  const first = firstRowId(root);
  if (!first) return;
  root.expand(first);
}

function expandAll(runtime: GridRuntime): void {
  const queue: GridLevelRuntime[] = [runtime.root];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const level = queue[cursor];
    if (level.schema.childLevels.length === 0) continue;
    for (const row of level.displayedRows().rows) {
      if (row.kind !== "data" || !row.hasChildren) continue;
      level.expand(row.id);
      for (const childLevelName of level.schema.childLevels) {
        queue.push(
          runtime.level(
            childPath(level.path, row.source.rowKey, childLevelName),
          ),
        );
      }
    }
  }
}

function performMoveCell(runtime: GridRuntime): void {
  const level = runtime.root;
  const rows = level.displayedRowSequence().rows;
  const columns = level.schema.columns;
  if (rows.length < 2 || columns.length < 2) return;
  const cursors = cursorManagerFor(runtime);
  cursors.moveCellCursorTo({
    path: level.path,
    rowId: rows[0].id,
    colId: columns[0].id,
  });
  cursors.moveCellCursorTo({
    path: level.path,
    rowId: rows[1].id,
    colId: columns[1].id,
  });
}

function performMoveCellCrossPath(runtime: GridRuntime): void {
  const root = runtime.root;
  const rootRow = firstRowId(root);
  if (!rootRow) return;
  const child = firstChildLevel(runtime, root, rootRow);
  if (!child) return;
  const rootColumn = root.schema.columns[0]?.id;
  const childColumn = child.schema.columns[0]?.id;
  const childRow = firstRowId(child);
  if (!rootColumn || !childColumn || !childRow) return;
  const cursors = cursorManagerFor(runtime);
  cursors.moveCellCursorTo({
    path: root.path,
    rowId: rootRow,
    colId: rootColumn,
  });
  cursors.moveCellCursorTo({
    path: child.path,
    rowId: childRow,
    colId: childColumn,
  });
}

function performSelectCellRange(runtime: GridRuntime): void {
  const level = runtime.root;
  const rows = level.displayedRowSequence().rows;
  const columns = level.schema.columns;
  if (rows.length < 10 || columns.length < 5) return;
  const cursors = cursorManagerFor(runtime);
  cursors.moveCellCursorTo({
    path: level.path,
    rowId: rows[0].id,
    colId: columns[0].id,
  });
  cursors.extendCellSelectionTo({
    path: level.path,
    rowId: rows[9].id,
    colId: columns[4].id,
  });
}

function performRowSelection(runtime: GridRuntime): void {
  const level = runtime.root;
  const rows = level.displayedRowSequence().rows;
  if (rows.length < 10) return;
  level.toggleRowSelection(rows[0].id);
  level.extendRowSelectionTo(rows[9].id);
  level.clearRowSelection();
}

function performStartCancelEdit(runtime: GridRuntime): void {
  const level = runtime.root;
  const row = firstRowId(level);
  const column = level.schema.columns[1]?.id;
  if (!row || !column) return;
  const controller = controllerFor(runtime, level.path);
  controller.startEdit({ rowId: row, colId: column }, "type", "x");
  controller.cancelEdit();
}

function performCommitCell(runtime: GridRuntime): void {
  const level = runtime.root;
  const row = firstRowId(level);
  const column = level.schema.columns[1]?.id;
  if (!row || !column) return;
  level.writeCell({ rowId: row, colId: column }, "committed");
}

function performDataRederive(runtime: GridRuntime): void {
  const level = runtime.root;
  const rows = level.displayedRowSequence().rows;
  if (rows.length === 0) return;
  void level.data.query?.refetch?.();
  level.writeCell({ rowId: rows[0].id, colId: "c1" }, "changed");
  void level.data.query?.sort?.set([{ colId: "c1", direction: "asc" }]);
  void level.data.query?.sort?.set(undefined);
}

function performExpansionLifecycle(runtime: GridRuntime): void {
  const level = runtime.root;
  const row = firstRowId(level);
  if (!row) return;
  level.toggleExpand(row);
  level.toggleExpand(row);
  level.toggleExpand(row);
  expandAll(runtime);
}

function touchAllDisplayed(runtime: GridRuntime): void {
  for (const level of runtime.registeredLevels()) {
    level.displayedRowSequence();
    level.displayedRows();
  }
}

function touchDisplayed(
  runtime: GridRuntime | null,
  timings: PhaseTimings,
): void {
  timePhase(timings, "touchDisplayed", () =>
    touchAllDisplayed(runtimeOrThrow(runtime)),
  );
}

function expand(
  runtime: GridRuntime | null,
  timings: PhaseTimings,
  fn: () => void,
): void {
  runtimeOrThrow(runtime);
  timePhase(timings, "expand", fn);
}

function attachSubscribers(
  runtime: GridRuntime | null,
  counters: BenchCounters,
  timings: PhaseTimings,
): () => void {
  return timePhase(timings, "attachSubscribers", () =>
    attachRuntimeSubscribers(runtimeOrThrow(runtime), counters),
  );
}

function runtimeOrThrow(runtime: GridRuntime | null): GridRuntime {
  if (!runtime) throw new Error("Benchmark runtime is not initialized.");
  return runtime;
}

function datasetOrThrow(dataset: BenchDataset | null): BenchDataset {
  if (!dataset) throw new Error("Benchmark dataset is not initialized.");
  return dataset;
}

function createPhaseTimings(): PhaseTimings {
  return {
    datasetBuild: 0,
    runtimeCreate: 0,
    expand: 0,
    touchDisplayed: 0,
    attachSubscribers: 0,
    action: 0,
    countDisplayed: 0,
    detachSubscribers: 0,
    runtimeDispose: 0,
    measuredWork: 0,
    wallClock: 0,
  };
}

function createMemoryProfile(baseline: number): MemoryProfile {
  return {
    baseline,
    afterDatasetBuild: baseline,
    datasetDelta: 0,
    afterRuntimeCreate: baseline,
    afterExpand: baseline,
    afterTouchDisplayed: baseline,
    afterAttachSubscribers: baseline,
    liveAfterAction: baseline,
    liveDelta: 0,
    afterDetach: baseline,
    afterRuntimeDispose: baseline,
    afterDatasetRelease: baseline,
    retainedDelta: 0,
  };
}

function timePhase<K extends keyof PhaseTimings, T>(
  timings: PhaseTimings,
  phase: K,
  fn: () => T,
): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    timings[phase] = roundMs(timings[phase] + performance.now() - start);
  }
}

function countDisplayedRows(runtime: GridRuntime): number {
  let count = 0;
  for (const level of runtime.registeredLevels()) {
    count += level.displayedRowSequence().rows.length;
  }
  return count;
}

function firstRowId(level: GridLevelRuntime): RowId | null {
  return level.displayedRowSequence().rows[0]?.id ?? null;
}

function firstChildLevel(
  runtime: GridRuntime,
  parent: GridLevelRuntime,
  rowId: RowId,
): GridLevelRuntime | null {
  const row = parent.displayedRow(rowId);
  if (!row || row.kind !== "data") return null;
  const childLevelName = parent.schema.childLevels[0];
  if (!childLevelName) return null;
  return runtime.level(
    childPath(parent.path, row.source.rowKey, childLevelName),
  );
}

function forceGc(): void {
  if (globalThis.gc) globalThis.gc();
}

function measuredHeapUsedMb(): number {
  forceGc();
  return heapUsedMb();
}

function heapUsedMb(): number {
  return roundMb(process.memoryUsage().heapUsed / 1024 / 1024);
}

function roundMb(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseArgs(argv: string[]): {
  dataset: BenchDatasetName | "all";
  bench: BenchName | "all";
  format: "json" | "markdown";
} {
  let dataset: BenchDatasetName | "all" = "regular";
  let bench: BenchName | "all" = "all";
  let format: "json" | "markdown" = "markdown";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dataset" && next) {
      dataset = parseDataset(next);
      i++;
    } else if (arg === "--bench" && next) {
      bench = parseBench(next);
      i++;
    } else if (arg === "--format" && next) {
      format = next === "json" ? "json" : "markdown";
      i++;
    }
  }
  return { dataset, bench, format };
}

function parseDataset(value: string): BenchDatasetName | "all" {
  if (value === "all") return value;
  if (datasetNames().includes(value as BenchDatasetName)) {
    return value as BenchDatasetName;
  }
  throw new Error(`Unknown dataset "${value}".`);
}

function parseBench(value: string): BenchName | "all" {
  if (value === "all") return value;
  if (BENCHES.includes(value as BenchName)) return value as BenchName;
  throw new Error(`Unknown benchmark "${value}".`);
}

function printMarkdown(results: BenchResult[]): void {
  process.stdout.write(
    [
      "| benchmark | dataset | nodes | paths | rows | dataset ms | runtime ms | expand ms | touch ms | subscribe ms | action ms | total ms | dataset MB | live delta MB | retained MB | row fires | sequence fires | selected fires | interaction fires | source fires | mutations |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      ...results.map(
        (result) =>
          `| ${[
            result.bench,
            result.dataset,
            result.nodeCount,
            result.pathCount,
            result.rowCount,
            result.timingsMs.datasetBuild.toFixed(2),
            result.timingsMs.runtimeCreate.toFixed(2),
            result.timingsMs.expand.toFixed(2),
            result.timingsMs.touchDisplayed.toFixed(2),
            result.timingsMs.attachSubscribers.toFixed(2),
            result.timingsMs.action.toFixed(2),
            result.timingsMs.measuredWork.toFixed(2),
            result.memoryMb.datasetDelta.toFixed(2),
            result.memoryMb.liveDelta.toFixed(2),
            result.memoryMb.retainedDelta.toFixed(2),
            result.counters.runtimeDisplayedRowFires,
            result.counters.runtimeDisplayedSequenceFires,
            result.counters.runtimeSelectedRowFires,
            result.counters.runtimeRowInteractionFires,
            result.counters.sourceSubscriberFires,
            result.counters.hostMutationCommittedEvents,
          ].join(" | ")} |`,
      ),
    ].join("\n") + "\n",
  );
}
