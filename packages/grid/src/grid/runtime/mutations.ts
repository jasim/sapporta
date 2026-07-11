import type {
  CellChange,
  CreateNodeResult,
  LevelDataSource,
  LevelSnapshot,
  WriteCapability,
} from "../data-sources/types";
import type { GridPath, RowKey, Coord } from "../types/identity";
import {
  makeRowId,
  phantomKeyFromDisplayedRowId,
  rowKeyOfRowId,
} from "../types/identity";
import type { DisplayedRows, TreeNode } from "../types/level-row";
import type { LevelSchema } from "../types/schema";
import { assertTreeNodeCanBeInserted, rowKeyOfTreeNode } from "../row-identity";
import type { GridEvents } from "./emitter";

export function createMutationRuntime(args: {
  readonly assertLive: () => void;
  readonly source: (path: GridPath) => LevelDataSource | undefined;
  readonly sourceSnapshot: (path: GridPath) => LevelSnapshot;
  readonly isWritable: (path: GridPath) => boolean;
  readonly displayedRows: (path: GridPath) => DisplayedRows;
  readonly schemaAt: (path: GridPath) => LevelSchema;
  readonly setDraftCell: (
    path: GridPath,
    rowKey: RowKey,
    colId: Coord["colId"],
    value: unknown,
  ) => void;
  readonly emit: <E extends keyof GridEvents>(
    event: E,
    payload: GridEvents[E],
  ) => void;
  readonly fault: (error: unknown) => void;
  readonly isDisposed: () => boolean;
}) {
  /** Resolves one current source and proves that its row identity is writable. */
  function requireWritable(path: GridPath): {
    source: LevelDataSource;
    write: WriteCapability;
  } {
    args.assertLive();
    const source = args.source(path);
    if (!source) {
      throw new Error(
        `GridRuntime: no source has been resolved for path "${path}". Expand the parent row first.`,
      );
    }
    if (!source.write) {
      throw new Error(
        `GridRuntime: source for path "${path}" is readonly — writeCell/applyChanges/createRow/removeRow are not available.`,
      );
    }
    if (!args.isWritable(path)) {
      throw new Error(
        `GridRuntime: source for path "${path}" has invalid row identity and cannot be mutated.`,
      );
    }
    return { source, write: source.write };
  }

  function writeCell(path: GridPath, coord: Coord, value: unknown): void {
    const { write } = requireWritable(path);
    const row = args.displayedRows(path).rowById.get(coord.rowId);
    if (!row) {
      throw new Error(
        `GridRuntime.writeCell: no displayed row "${coord.rowId}" at path "${path}".`,
      );
    }
    if (row.kind === "phantom") {
      const rowKey = phantomKeyFromDisplayedRowId(coord.rowId);
      if (!rowKey) {
        throw new Error(
          `GridRuntime.writeCell: malformed phantom row id "${coord.rowId}".`,
        );
      }
      args.setDraftCell(path, rowKey, coord.colId, value);
      return;
    }
    if (row.kind !== "data") {
      throw new Error(
        `GridRuntime.writeCell: row "${coord.rowId}" is ${row.kind}, not editable data.`,
      );
    }
    const rowKey = rowKeyOfRowId(coord.rowId);
    const oldValue = readCellValue(
      args.sourceSnapshot(path),
      rowKey,
      coord.colId,
    );
    write.setCell(rowKey, coord.colId, value);
    args.emit("mutationCommitted", {
      kind: "cell",
      path,
      coord,
      oldValue,
      newValue: value,
    });
  }

  function applyChanges(path: GridPath, changes: readonly CellChange[]): void {
    // Capture every prior value from one snapshot before asking the source to
    // apply the batch. Host listeners receive one coherent mutation record.
    const { write } = requireWritable(path);
    const snapshot = args.sourceSnapshot(path);
    const priors = changes.map((change) =>
      readCellValue(snapshot, change.rowKey, change.colId),
    );
    write.applyChanges(changes);
    args.emit("mutationCommitted", {
      kind: "cells",
      path,
      edits: changes.map((change, index) => ({
        coord: { rowId: makeRowId(path, change.rowKey), colId: change.colId },
        oldValue: priors[index],
        newValue: change.value,
      })),
    });
  }

  async function createRow(
    path: GridPath,
    node: TreeNode,
    atIndex?: number,
  ): Promise<CreateNodeResult> {
    const { write } = requireWritable(path);
    const existingKeys = assertCreateNode(path, node);
    const result = await write.createNode(node, atIndex);
    try {
      // The source result is authoritative. Invalid identity faults the
      // runtime because later paths and membership checks cannot trust it.
      assertAuthoritativeCreatedNode(path, result.node, existingKeys);
    } catch (error) {
      args.fault(error);
      return result;
    }
    if (!args.isDisposed()) {
      args.emit("mutationCommitted", {
        kind: "insert",
        path,
        node: result.node,
        atIndex: result.atIndex,
      });
    }
    return result;
  }

  async function removeRow(path: GridPath, rowKey: RowKey): Promise<void> {
    const { write } = requireWritable(path);
    const { node, index } = readNodeWithIndex(
      args.sourceSnapshot(path),
      rowKey,
    );
    await write.removeNode(rowKey);
    if (!args.isDisposed()) {
      args.emit("mutationCommitted", {
        kind: "remove",
        path,
        node,
        atIndex: index,
      });
    }
  }

  function assertCreateNode(
    path: GridPath,
    node: TreeNode,
  ): ReadonlySet<RowKey> {
    const schema = args.schemaAt(path);
    if (node.levelName !== schema.name) {
      throw new Error(
        `GridRuntime.createRow: node levelName "${node.levelName}" does not match level "${schema.name}".`,
      );
    }
    rowKeyOfTreeNode(node, "GridRuntime.createRow");
    const nodes = args.sourceSnapshot(path).nodes;
    assertTreeNodeCanBeInserted(nodes, node, "GridRuntime.createRow");
    return new Set(nodes.map((existing) => existing.rowKey));
  }

  function assertAuthoritativeCreatedNode(
    path: GridPath,
    node: TreeNode,
    existingKeys: ReadonlySet<RowKey>,
  ): void {
    const schema = args.schemaAt(path);
    if (node.levelName !== schema.name) {
      throw new Error(
        `GridRuntime.createRow: source returned levelName "${node.levelName}" for level "${schema.name}".`,
      );
    }
    const rowKey = rowKeyOfTreeNode(
      node,
      "GridRuntime.createRow authoritative result",
    );
    if (existingKeys.has(rowKey)) {
      throw new Error(
        `GridRuntime.createRow: source returned duplicate TreeNode.rowKey "${rowKey}".`,
      );
    }
  }

  return { requireWritable, writeCell, applyChanges, createRow, removeRow };
}

function readCellValue(
  snapshot: LevelSnapshot,
  rowKey: RowKey,
  colId: Coord["colId"],
): unknown {
  const node = snapshot.nodes.find((candidate) => candidate.rowKey === rowKey);
  return node?.columns[colId];
}

function readNodeWithIndex(snapshot: LevelSnapshot, rowKey: RowKey) {
  const index = snapshot.nodes.findIndex(
    (candidate) => candidate.rowKey === rowKey,
  );
  if (index < 0) {
    throw new Error(
      `GridRuntime.removeRow: no source row with rowKey '${rowKey}'`,
    );
  }
  return { node: snapshot.nodes[index], index };
}
// Source write boundary.
//
// Application writes pass through this module so row identity, row kind, and
// source capabilities are checked in one place. Successful source-backed
// writes emit host mutation events. Draft-cell writes stay in the draft
// channel and do not claim that source data changed.
