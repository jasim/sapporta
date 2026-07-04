import { useCallback, useState, useSyncExternalStore } from "react";
import {
  collectRowOperationTargets,
  type GridPath,
  type GridRuntime,
  type RowKey,
} from "@sapporta/grid";
import { errorMessage } from "../../platform/http";
import type { TGridRowsByLevel } from "../grid-adapter/tgrid-types";
import type { TGridSession } from "../state/tgrid-session";

export type TableSelection =
  | {
      kind: "none";
      count: 0;
    }
  | {
      kind: "rows";
      count: number;
      clear: () => void;
      deleteSelected: () => Promise<void>;
    };

type TableSelectionSession = {
  runtime: GridRuntime;
  setErrorBanner: (message: string | null) => void;
};

type TableDeleteTarget = {
  path: GridPath;
  rowKey: RowKey;
};

export function useTableSelection<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(session: TGridSession<RowsByLevel, AppServices>): TableSelection {
  const count = useSelectedDataRowCount(session);
  const [deleting, setDeleting] = useState(false);
  const clear = useCallback(() => {
    clearTableSelection(session);
  }, [session]);
  const deleteSelected = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteSelectedTableRows(session);
    } finally {
      setDeleting(false);
    }
  }, [deleting, session]);

  if (count === 0) return { kind: "none", count };
  return { kind: "rows", count, clear, deleteSelected };
}

export function clearTableSelection(
  session: TableSelectionSession | undefined,
): void {
  if (!session) return;
  const runtime = session.runtime;
  for (const path of runtime.registeredPaths()) {
    if (runtime.rowInteractionSnapshotFor(path).selectedRowIds.length === 0) {
      continue;
    }
    runtime.rowInteraction.clearRowSelection(path);
  }
}

export async function deleteSelectedTableRows(
  session: TableSelectionSession | undefined,
): Promise<void> {
  if (!session) return;
  const targets = selectedTableDeleteTargets(session);
  if (targets.length === 0) return;

  const touchedPaths = new Set<GridPath>();
  for (const target of targets) {
    try {
      await session.runtime.removeRow(target.path, target.rowKey);
      touchedPaths.add(target.path);
    } catch (err) {
      touchedPaths.add(target.path);
      refetchPaths(session.runtime, touchedPaths);
      session.setErrorBanner(`Failed to delete row: ${errorMessage(err)}`);
      return;
    }
  }

  refetchPaths(session.runtime, touchedPaths);
  clearTableSelection(session);
}

export function selectedTableDeleteTargets(
  session: TableSelectionSession | undefined,
): Array<TableDeleteTarget> {
  if (!session) return [];
  const runtime = session.runtime;
  const targets: Array<TableDeleteTarget & { depth: number }> = [];

  for (const target of collectRowOperationTargets(runtime)) {
    if (target.row.kind === "data") {
      targets.push({
        path: target.path,
        rowKey: target.rowKey,
        depth: pathDepth(target.path),
      });
    }
  }

  targets.sort((a, b) => b.depth - a.depth);
  return targets.map(({ path, rowKey }) => ({ path, rowKey }));
}

function useSelectedDataRowCount(
  session: TableSelectionSession | undefined,
): number {
  return useSyncExternalStore(
    (notify) => subscribeSelectedDataRows(session, notify),
    () => selectedTableDeleteTargets(session).length,
    () => 0,
  );
}

function subscribeSelectedDataRows(
  session: TableSelectionSession | undefined,
  notify: () => void,
): () => void {
  if (!session) return () => {};

  const runtime = session.runtime;
  const unsubs: Array<() => void> = [];
  const subscribedPaths = new Set<GridPath>();

  function subscribeKnownPaths(): void {
    for (const path of runtime.registeredPaths()) {
      if (subscribedPaths.has(path)) continue;
      subscribedPaths.add(path);
      unsubs.push(runtime.subscribeRowInteractionSnapshot(path, notify));
      unsubs.push(
        runtime.controllerFor(path).subscribe((state, previous) => {
          if (state.cellSelection !== previous.cellSelection) notify();
        }),
      );
      unsubs.push(runtime.subscribeDisplayedRowSequence(path, notify));
    }
  }

  subscribeKnownPaths();
  unsubs.push(
    runtime.subscribeRegistry(() => {
      subscribeKnownPaths();
      notify();
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

function pathDepth(path: GridPath): number {
  return String(path).split(".").length;
}

function refetchPaths(
  runtime: GridRuntime,
  paths: ReadonlySet<GridPath>,
): void {
  for (const path of paths) {
    void runtime.sourceFor(path).query?.refetch?.();
  }
}
