import {
  decomposePath,
  makeRowId,
  type CursorContinuation,
  type GridPath,
  type GridRuntime,
  type RowKey,
} from "@sapporta/grid";
import { errorMessage } from "../../platform/http";

export type TableSelectionSession = {
  runtime: GridRuntime;
  setErrorBanner: (message: string | null) => void;
};

export type TableDeleteTarget = {
  path: GridPath;
  rowKey: RowKey;
};

export type TableRowDeletionPlan = {
  targets: readonly TableDeleteTarget[];
  continuation: CursorContinuation;
};

export function planTableRowDeletion(
  session: TableSelectionSession | undefined,
): TableRowDeletionPlan | null {
  if (!session) return null;
  const targets = selectedTableDeleteTargets(session);
  if (targets.length === 0) return null;
  return {
    targets,
    continuation: session.runtime.planCursorContinuationForRowRemoval(
      targets.map((target) => ({
        path: target.path,
        rowId: makeRowId(target.path, target.rowKey),
      })),
    ),
  };
}

export async function deleteSelectedTableRows(
  session: TableSelectionSession | undefined,
): Promise<void> {
  if (!session) return;
  const plan = planTableRowDeletion(session);
  if (!plan) return;

  // Apply while the pre-mutation visible order still exists. Sources may
  // publish removals synchronously or after I/O; continuation cannot depend on
  // that timing. The existing controller effects queue performs DOM focus and
  // reveal after React commits the resulting row structure.
  session.runtime.applyCursorContinuation(plan.continuation);

  const touchedPaths = new Set<GridPath>();
  for (const target of plan.targets) {
    try {
      touchedPaths.add(target.path);
      await session.runtime.removeRow(target.path, target.rowKey);
    } catch (err) {
      session.setErrorBanner(`Failed to delete row: ${errorMessage(err)}`);
      await refetchPaths(session.runtime, touchedPaths);
      return;
    }
  }

  await refetchPaths(session.runtime, touchedPaths);
  clearTableSelection(session);
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

export function selectedTableDeleteTargets(
  session: TableSelectionSession | undefined,
): TableDeleteTarget[] {
  if (!session) return [];
  const runtime = session.runtime;
  const targets: Array<TableDeleteTarget & { depth: number }> = [];

  for (const path of runtime.registeredPaths()) {
    if (runtime.rowInteractionSnapshotFor(path).selectedRowIds.length === 0) {
      continue;
    }
    for (const target of runtime.rowOperationTargetsFor(path)) {
      if (target.row.kind === "data") {
        targets.push({
          path: target.path,
          rowKey: target.rowKey,
          depth: pathDepth(target.path),
        });
      }
    }
  }

  targets.sort((a, b) => b.depth - a.depth);
  return targets.map(({ path, rowKey }) => ({ path, rowKey }));
}

async function refetchPaths(
  runtime: GridRuntime,
  paths: ReadonlySet<GridPath>,
): Promise<void> {
  await Promise.all(
    Array.from(paths, async (path) => {
      await runtime.sourceFor(path).query?.refetch?.();
    }),
  );
}

function pathDepth(path: GridPath): number {
  return decomposePath(path).edges.length;
}
