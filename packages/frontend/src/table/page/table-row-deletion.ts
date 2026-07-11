import {
  type GridLevelRuntime,
  type GridRuntime,
  type RowOperationTarget,
} from "@sapporta/grid";
import { errorMessage } from "../../platform/http";

export type TableSelectionSession = {
  runtime: {
    readonly rowOperations: Pick<
      GridRuntime["rowOperations"],
      "selectedDataTargets" | "remove"
    >;
    registeredLevels(): readonly Pick<
      GridLevelRuntime,
      | "selectedRowIds"
      | "clearRowSelection"
      | "subscribeRowInteractionSnapshot"
      | "subscribeDisplayedRowSequence"
    >[];
    subscribeLevels(listener: () => void): () => void;
  };
  setErrorBanner: (message: string | null) => void;
};

export type TableDeleteTarget = RowOperationTarget<"data">;

export async function deleteSelectedTableRows(
  session: TableSelectionSession | undefined,
): Promise<void> {
  if (!session) return;

  try {
    const targets = session.runtime.rowOperations.selectedDataTargets();
    if (targets.length === 0) return;
    const result = await session.runtime.rowOperations.remove(targets);
    if (result.kind === "partial") {
      session.setErrorBanner(
        `Failed to delete row: ${errorMessage(result.error)}`,
      );
    }
  } catch (error) {
    session.setErrorBanner(`Failed to delete row: ${errorMessage(error)}`);
  }
}

export function clearTableSelection(
  session: TableSelectionSession | undefined,
): void {
  if (!session) return;
  for (const level of session.runtime.registeredLevels()) {
    if (level.selectedRowIds().length > 0) level.clearRowSelection();
  }
}

export function selectedTableDeleteTargets(
  session: TableSelectionSession | undefined,
): readonly TableDeleteTarget[] {
  return session?.runtime.rowOperations.selectedDataTargets() ?? [];
}
