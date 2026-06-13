import { useCallback, useState, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import {
  rowKeyOfRowId,
  type GridPath,
  type GridRuntime,
  type RowKey,
} from "@sapporta/grid";
import { TopBarButton } from "@/shell/components/TopBar";
import { errorMessage } from "@/platform/http";

export type TableToolbarSession = {
  runtime: GridRuntime;
  setErrorBanner: (message: string | null) => void;
};

export type TableToolbarDeleteRowActionProps = {
  session?: TableToolbarSession;
};

export type TableToolbarSelectionState =
  | { kind: "none"; count: 0 }
  | { kind: "single"; count: 1 }
  | { kind: "multiple"; count: number };

type TableToolbarDeleteRowTarget = {
  path: GridPath;
  rowKey: RowKey;
};

export function TableToolbarDeleteRowAction({
  session,
}: TableToolbarDeleteRowActionProps) {
  const hasSelectedRow = useHasAnySelectedDataRow(session);
  const { deleteSelectedRows, deleting } =
    useDeleteSelectedTableToolbarRows(session);

  return (
    <TopBarButton
      tone="ghost"
      icon={<Trash2 className="h-[12px] w-[12px]" />}
      disabled={!hasSelectedRow || deleting}
      onClick={deleteSelectedRows}
    >
      <span className="sr-only">Delete Row</span>
    </TopBarButton>
  );
}

export function useDeleteSelectedTableToolbarRows(
  session: TableToolbarSession | undefined,
): { deleteSelectedRows: () => void; deleting: boolean } {
  const [deleting, setDeleting] = useState(false);

  const deleteSelectedRows = useCallback(() => {
    if (!session || deleting) return;
    setDeleting(true);
    void (async () => {
      try {
        await deleteSelectedTableToolbarRows(session);
      } finally {
        setDeleting(false);
      }
    })();
  }, [deleting, session]);

  return { deleteSelectedRows, deleting };
}

export async function deleteSelectedTableToolbarRows(
  session: TableToolbarSession | undefined,
): Promise<void> {
  if (!session) return;
  const targets = selectedTableToolbarDeleteTargets(session);
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
  clearTableToolbarSelection(session);
}

export function useTableToolbarSelection(
  session: TableToolbarSession | undefined,
): TableToolbarSelectionState {
  const count = useSelectedDataRowCount(session);
  if (count === 0) return { kind: "none", count };
  if (count === 1) return { kind: "single", count };
  return { kind: "multiple", count };
}

export function clearTableToolbarSelection(
  session: TableToolbarSession | undefined,
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

function useHasAnySelectedDataRow(
  session: TableToolbarSession | undefined,
): boolean {
  return useSelectedDataRowCount(session) > 0;
}

function useSelectedDataRowCount(
  session: TableToolbarSession | undefined,
): number {
  // Keep the toolbar affordance in step with the table tree the app is showing.
  // A row selected inside an expanded child table should enable the same delete
  // action as a row selected in the root table.
  return useSyncExternalStore(
    (notify) => subscribeSelectedDataRows(session, notify),
    () => selectedDataRowCount(session),
    () => 0,
  );
}

function selectedDataRowCount(
  session: TableToolbarSession | undefined,
): number {
  return selectedTableToolbarDeleteTargets(session).length;
}

export function selectedTableToolbarDeleteTargets(
  session: TableToolbarSession | undefined,
): Array<{ path: GridPath; rowKey: RowKey }> {
  if (!session) return [];
  const runtime = session.runtime;
  const targets: Array<TableToolbarDeleteRowTarget & { depth: number }> = [];

  for (const path of runtime.registeredPaths()) {
    const rowInteraction = runtime.rowInteractionSnapshotFor(path);
    for (const rowId of rowInteraction.selectedRowIds) {
      // Only persisted table rows are delete candidates. Draft rows, summary
      // rows, footers, and rows filtered away from the displayed set should not
      // make the toolbar look ready to delete.
      if (runtime.displayedRowFor(path, rowId)?.kind === "data") {
        targets.push({
          path,
          rowKey: rowKeyOfRowId(rowId),
          depth: pathDepth(path),
        });
      }
    }
  }

  targets.sort((a, b) => b.depth - a.depth);
  return targets.map(({ path, rowKey }) => ({ path, rowKey }));
}

function subscribeSelectedDataRows(
  session: TableToolbarSession | undefined,
  notify: () => void,
): () => void {
  if (!session) return () => {};

  const runtime = session.runtime;
  const unsubs: Array<() => void> = [];
  const subscribedPaths = new Set<GridPath>();

  function subscribeKnownPaths(): void {
    // Expanded child tables register their own grid paths. Attach listeners as
    // those paths appear so custom nested table pages get the delete affordance
    // without wiring a separate toolbar for each level.
    for (const path of runtime.registeredPaths()) {
      if (subscribedPaths.has(path)) continue;
      subscribedPaths.add(path);
      // Selection changes decide whether there is anything to delete; displayed
      // row changes clear the affordance when a selected row disappears or stops
      // being a persisted data row.
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

function pathDepth(path: GridPath): number {
  return String(path).split(".").length;
}

function refetchPaths(
  runtime: GridRuntime,
  paths: ReadonlySet<GridPath>,
): void {
  for (const path of paths) {
    runtime.sourceFor(path).refetch();
  }
}
