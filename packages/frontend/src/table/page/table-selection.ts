import { useCallback, useState, useSyncExternalStore } from "react";
import type { GridPath } from "@sapporta/grid";
import type { TGridRowsByLevel } from "../grid-adapter/tgrid-types";
import type { TGridSession } from "../state/tgrid-session";
import {
  clearTableSelection,
  deleteSelectedTableRows,
  selectedTableDeleteTargets,
  type TableSelectionSession,
} from "./table-row-deletion";

export {
  clearTableSelection,
  deleteSelectedTableRows,
  planTableRowDeletion,
  selectedTableDeleteTargets,
  type TableDeleteTarget,
  type TableRowDeletionPlan,
  type TableSelectionSession,
} from "./table-row-deletion";

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
