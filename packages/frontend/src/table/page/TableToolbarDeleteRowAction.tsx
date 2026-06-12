import { useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { type GridPath, type GridRuntime } from "@sapporta/grid";
import { TopBarButton } from "@/shell/components/TopBar";

export type TableToolbarSession = {
  runtime: GridRuntime;
};

export type TableToolbarDeleteRowActionProps = {
  session?: TableToolbarSession;
};

export function TableToolbarDeleteRowAction({
  session,
}: TableToolbarDeleteRowActionProps) {
  const hasSelectedRow = useHasAnySelectedDataRow(session);

  return (
    <TopBarButton
      tone="ghost"
      icon={<Trash2 className="h-[12px] w-[12px]" />}
      disabled={!hasSelectedRow}
    >
      <span className="sr-only">Delete Row</span>
    </TopBarButton>
  );
}

function useHasAnySelectedDataRow(
  session: TableToolbarSession | undefined,
): boolean {
  // Keep the toolbar affordance in step with the table tree the app is showing.
  // A row selected inside an expanded child table should enable the same delete
  // action as a row selected in the root table.
  return useSyncExternalStore(
    (notify) => subscribeSelectedDataRows(session, notify),
    () => hasAnySelectedDataRow(session),
    () => false,
  );
}

function hasAnySelectedDataRow(
  session: TableToolbarSession | undefined,
): boolean {
  if (!session) return false;
  const runtime = session.runtime;
  for (const path of runtime.registeredPaths()) {
    const rowInteraction = runtime.rowInteractionSnapshotFor(path);
    for (const rowId of rowInteraction.selectedRowIds) {
      // Only persisted table rows are delete candidates. Draft rows, summary
      // rows, footers, and rows filtered away from the displayed set should not
      // make the toolbar look ready to delete.
      if (runtime.displayedRowFor(path, rowId)?.kind === "data") {
        return true;
      }
    }
  }
  return false;
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
