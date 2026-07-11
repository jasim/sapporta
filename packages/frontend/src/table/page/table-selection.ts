import { useCallback, useState, useSyncExternalStore } from "react";
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
  selectedTableDeleteTargets,
  type TableDeleteTarget,
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
  type SelectionLevel = ReturnType<
    TableSelectionSession["runtime"]["registeredLevels"]
  >[number];
  const subscriptions = new Map<SelectionLevel, () => void>();

  function syncLevels(): void {
    const registered = new Set(runtime.registeredLevels());
    for (const [level, unsubscribe] of subscriptions) {
      if (registered.has(level)) continue;
      unsubscribe();
      subscriptions.delete(level);
    }
    for (const level of registered) {
      if (subscriptions.has(level)) continue;
      const unsubscribeSelection =
        level.subscribeRowInteractionSnapshot(notify);
      const unsubscribeRows = level.subscribeDisplayedRowSequence(notify);
      subscriptions.set(level, () => {
        unsubscribeSelection();
        unsubscribeRows();
      });
    }
  }

  syncLevels();
  const unsubscribeLevels = runtime.subscribeLevels(() => {
    syncLevels();
    notify();
  });

  return () => {
    unsubscribeLevels();
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
  };
}
