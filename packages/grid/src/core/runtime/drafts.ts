import type {
  CreateNodeResult,
  LevelDataSource,
  LevelSourceState,
  PhantomChannel,
} from "../data-sources/types";
import type { ColId, GridPath, RowKey } from "../types/identity";
import type { PhantomRow, TreeNode } from "../types/level-row";
import type { LevelSchema } from "../types/schema";
import type { GridEvents } from "./emitter";

export function createDraftRuntime(args: {
  readonly phantoms: PhantomChannel;
  readonly source: (path: GridPath) => LevelDataSource | undefined;
  readonly sourceState: (path: GridPath) => LevelSourceState;
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly isRegistered: (path: GridPath) => boolean;
  readonly assertLevelLive: (path: GridPath) => void;
  readonly runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly createRow: (
    path: GridPath,
    node: TreeNode,
    atIndex?: number,
  ) => Promise<CreateNodeResult>;
  readonly setLifecycleCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) => void;
  readonly isBlank: (columns: Readonly<Record<ColId, unknown>>) => boolean;
  readonly emit: <E extends keyof GridEvents>(
    event: E,
    payload: GridEvents[E],
  ) => void;
  readonly isDisposed: () => boolean;
}) {
  // The key contains both path and row key because draft row keys are local to
  // a path. The promise is removed after success or failure so a failed draft
  // can be edited and committed again.
  const pendingCreates = new Map<string, Promise<CreateNodeResult>>();

  function requireEligibility(path: GridPath): void {
    // Reading drafts is always possible, but changing them requires a live,
    // ready, writable level. This keeps author state aligned with a source that
    // can eventually accept it.
    args.assertLevelLive(path);
    const source = args.source(path)!;
    const state = args.sourceState(path);
    if (!source.write) {
      throw new Error(
        `GridRuntime: drafts are unavailable for readonly path "${path}".`,
      );
    }
    if (state.status !== "ready") {
      throw new Error(
        `GridRuntime: drafts are unavailable while path "${path}" is ${state.status}.`,
      );
    }
  }

  function requireEditingEligibility(path: GridPath): void {
    // Cell editing implies that the draft can later become a source row.
    requireEligibility(path);
    const source = args.source(path)!;
    if (source.write?.createNode) return;
    throw new Error(
      `GridRuntime: drafts require row creation at path "${path}".`,
    );
  }

  function commit(
    path: GridPath,
    rowKey: RowKey,
    atIndex?: number,
  ): Promise<CreateNodeResult> {
    if (args.isDisposed()) {
      return Promise.reject(new Error("GridRuntime has been disposed."));
    }
    if (!args.isRegistered(path)) {
      return Promise.reject(new Error("Grid level is no longer registered."));
    }
    const key = `${path}\u0000${rowKey}`;
    const existing = pendingCreates.get(key);
    // A blur, Enter key, and explicit save can request the same commit during
    // one turn. They all observe the same source operation and result.
    if (existing) return existing;
    const promise = args.runOperation(async () => {
      args.assertLevelLive(path);
      requireEligibility(path);
      const phantom = args.phantoms
        .get(path)
        .find((item) => item.rowKey === rowKey);
      if (!phantom) {
        throw new Error(
          `GridRuntime.commitPhantomRow: no phantom with rowKey "${rowKey}" at path "${path}".`,
        );
      }
      if (phantom.state.kind === "saving") {
        throw new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is already saving.`,
        );
      }
      if (args.isBlank(phantom.columns)) {
        throw new Error(
          `GridRuntime.commitPhantomRow: phantom with rowKey "${rowKey}" at path "${path}" is blank.`,
        );
      }
      args.phantoms.setState(path, rowKey, { kind: "saving" });
      const node: TreeNode = {
        rowKey,
        levelName: args.schemaAt(path).name,
        columns: { ...phantom.columns },
      };
      try {
        const result = await args.createRow(path, node, atIndex);
        args.phantoms.remove(path, rowKey);
        if (!args.isDisposed()) {
          args.emit("phantomRowCommitted", { path, rowKey, ...result });
        }
        return result;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        args.phantoms.setState(path, rowKey, { kind: "failed", reason });
        if (!args.isDisposed()) {
          args.emit("phantomRowCreateFailed", { path, rowKey, reason });
        }
        throw error;
      } finally {
        pendingCreates.delete(key);
      }
    });
    pendingCreates.set(key, promise);
    return promise;
  }

  function add(
    path: GridPath,
    rowKey: RowKey,
    columns: Readonly<Record<ColId, unknown>> = {},
  ): void {
    requireEligibility(path);
    args.phantoms.add(path, {
      rowKey,
      columns: Object.freeze({ ...columns }),
      state: { kind: "editing" },
    });
  }

  function setCell(
    path: GridPath,
    rowKey: RowKey,
    colId: ColId,
    value: unknown,
  ) {
    requireEditingEligibility(path);
    if (!args.phantoms.get(path).some((draft) => draft.rowKey === rowKey)) {
      throw new Error(
        `GridRuntime.drafts.setCell: no draft with rowKey "${rowKey}" at path "${path}".`,
      );
    }
    args.setLifecycleCell(path, rowKey, colId, value);
  }

  return {
    requireEligibility,
    requireEditingEligibility,
    get: (path: GridPath): readonly PhantomRow[] => args.phantoms.get(path),
    subscribe: (path: GridPath, listener: () => void) =>
      args.phantoms.subscribe(path, listener),
    add,
    remove: (path: GridPath, rowKey: RowKey) =>
      args.phantoms.remove(path, rowKey),
    setCell,
    commit,
    dispose: () => pendingCreates.clear(),
  };
}
// Explicit draft commands for one runtime.
//
// Drafts stay in the phantom channel until commit creates an authoritative
// source row. This module owns eligibility checks and promise de-duplication.
// Automatic append-draft behavior lives in phantom-row-lifecycle.ts.
