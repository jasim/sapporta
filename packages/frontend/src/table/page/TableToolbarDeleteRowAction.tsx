import { useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import {
  rootPath,
  rowsInSelection,
  type GridPath,
  type GridRuntime,
  type RowId,
} from "@sapporta/grid";
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
  const actionState = useDeleteRowActionState(session);
  const label = actionState === "multiple" ? "Delete Rows" : "Delete Row";

  return (
    <TopBarButton
      tone="ghost"
      icon={<Trash2 className="h-[12px] w-[12px]" />}
      disabled={actionState === "none"}
    >
      <span className="sr-only">{label}</span>
    </TopBarButton>
  );
}

type DeleteRowActionState = "none" | "single" | "multiple";

function useDeleteRowActionState(
  session: TableToolbarSession | undefined,
): DeleteRowActionState {
  return useSyncExternalStore(
    (notify) => {
      if (!session) return () => {};
      const root = rootPath(session.runtime.schema.rootLevel);
      const controller = session.runtime.controllerFor(root);
      const unsubs = [
        controller.subscribe((state, previous) => {
          if (
            state.liveCellFocus !== previous.liveCellFocus ||
            state.cellSelection !== previous.cellSelection
          ) {
            notify();
          }
        }),
        session.runtime.subscribeRowInteractionSnapshot(root, notify),
        session.runtime.subscribeDisplayedRowSequence(root, notify),
      ];
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    () => {
      if (!session) return "none";
      return readDeleteRowActionState(
        session,
        rootPath(session.runtime.schema.rootLevel),
      );
    },
    () => "none",
  );
}

function readDeleteRowActionState(
  session: TableToolbarSession,
  root: GridPath,
): DeleteRowActionState {
  const runtime = session.runtime;
  const displayed = runtime.displayedRowsFor(root);
  const rowInteraction = runtime.rowInteractionSnapshotFor(root);
  const selectedRowCount = countDeletableRows(
    rowInteraction.selectedRowIds,
    displayed,
  );
  const controllerState = runtime.controllerFor(root).getState();
  let selectedCellRowCount = 0;
  if (controllerState.cellSelection) {
    selectedCellRowCount = countDeletableRows(
      rowsInSelection(controllerState.cellSelection, displayed),
      displayed,
    );
  }

  if (selectedRowCount > 1 || selectedCellRowCount > 1) return "multiple";
  if (selectedRowCount === 1 || selectedCellRowCount === 1) return "single";
  if (isDeletableRow(controllerState.liveCellFocus?.rowId, displayed)) {
    return "single";
  }
  if (isDeletableRow(rowInteraction.activeRowId, displayed)) {
    return "single";
  }
  return "none";
}

type DisplayedRows = ReturnType<GridRuntime["displayedRowsFor"]>;

function countDeletableRows(
  rowIds: readonly RowId[],
  displayed: DisplayedRows,
): number {
  return rowIds.filter((rowId) => isDeletableRow(rowId, displayed)).length;
}

function isDeletableRow(
  rowId: RowId | null | undefined,
  displayed: DisplayedRows,
): boolean {
  if (!rowId) return false;
  return displayed.rowById.get(rowId)?.kind === "data";
}
