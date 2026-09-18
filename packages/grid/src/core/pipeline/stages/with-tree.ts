import type { GridPath, RowId, RowKey } from "../../types/identity";
import { makeLevelRowId, makeRowId } from "../../types/identity";
import type {
  LevelOptions,
  PhantomRow,
  TreeRowFacts,
} from "../../types/level-row";
import {
  isTreeRowExpanded,
  treeParentKey,
  type TreeExpansionView,
  type TreeStructure,
} from "../../types/tree";
import type { ProtoRow } from "../types";

// Tree levels (`LevelSchema.tree`) show the rows of one level as a tree: each
// row names its parent through a parent-key field, and the grid renders the
// rows depth-first under one header. The source still delivers a flat,
// already sorted and filtered list. This stage is where that list becomes a
// tree.
//
// The stage:
//   - groups rows by parent key, keeping source order among siblings, so a
//     source sort orders the siblings at every depth;
//   - places drafts under the row their parent-key field names, after that
//     row's other children, and drafts without a parent at the end;
//   - attaches `TreeRowFacts` to every row;
//   - omits the rows under a collapsed ancestor.
//
// Bad data must not hang or crash the grid. A row whose parent is not in the
// snapshot (filtered out, cut off by a page limit, outside the row scope, or
// dangling) is shown at top level. A parent loop is cut: the first row of the
// loop in source order is shown at top level, and `loopRowIds` names it so
// the runtime can report the problem.

export type WithTreeArgs = {
  readonly path: GridPath;
  /** Data rows in source order. */
  readonly rows: readonly ProtoRow[];
  readonly phantoms: readonly PhantomRow[];
  readonly options: LevelOptions;
  readonly parentKeyField: string;
  readonly expansion: TreeExpansionView;
  readonly contextRowKeys: readonly RowKey[] | undefined;
};

export type WithTreeResult = {
  /** Displayed tree rows, with `tree` facts, in display order. */
  readonly rows: ProtoRow[];
  readonly structure: TreeStructure;
};

type TreeProtoRow = Extract<ProtoRow, { kind: "data" | "phantom" }>;

type Entry = {
  readonly id: RowId;
  readonly row: TreeProtoRow;
  readonly parentKey: RowKey | null;
};

export function withTree(args: WithTreeArgs): WithTreeResult {
  const { path, parentKeyField } = args;
  const entries: Entry[] = [];
  const dataIdByKey = new Map<RowKey, RowId>();

  for (const row of args.rows) {
    if (row.kind !== "data") {
      throw new Error(
        `Tree level at path "${path}" cannot show "${row.kind}" rows.`,
      );
    }
    const id = makeRowId(path, row.rowKey);
    dataIdByKey.set(row.rowKey, id);
    entries.push({
      id,
      row,
      parentKey: treeParentKey(row.columns[parentKeyField]),
    });
  }
  if (args.options.allowPhantoms) {
    for (const phantom of args.phantoms) {
      entries.push({
        id: makeLevelRowId(path, "phantom", phantom.rowKey),
        row: {
          kind: "phantom",
          rowKey: phantom.rowKey,
          columns: phantom.columns,
          source: phantom,
        },
        parentKey: treeParentKey(phantom.columns[parentKeyField]),
      });
    }
  }

  // Group by the parent a row names. Only data rows can be parents; a row
  // whose parent key matches no data row is an orphan and joins the top
  // level. Drafts follow the data rows, so they sort after their siblings.
  const namedChildren = new Map<RowId, Entry[]>();
  const topLevel: Entry[] = [];
  for (const entry of entries) {
    const parentId =
      entry.parentKey === null ? undefined : dataIdByKey.get(entry.parentKey);
    if (parentId === undefined) {
      topLevel.push(entry);
      continue;
    }
    const siblings = namedChildren.get(parentId);
    if (siblings) siblings.push(entry);
    else namedChildren.set(parentId, [entry]);
  }

  const order: RowId[] = [];
  const parentById = new Map<RowId, RowId | null>();
  const depthById = new Map<RowId, number>();
  const childrenById = new Map<RowId, Entry[]>();
  const loopRowIds: RowId[] = [];

  // Depth-first walk with an explicit stack, so a deep chain cannot overflow
  // the call stack. A row is marked when it is pushed; each row sits in one
  // parent's list, so reaching a marked row again means a parent loop.
  function attach(root: Entry): void {
    parentById.set(root.id, null);
    depthById.set(root.id, 0);
    const stack: Entry[] = [root];
    while (stack.length > 0) {
      const entry = stack.pop()!;
      order.push(entry.id);
      const named = namedChildren.get(entry.id);
      if (!named) continue;
      const depth = depthById.get(entry.id)! + 1;
      const attached: Entry[] = [];
      for (const child of named) {
        if (parentById.has(child.id)) continue;
        parentById.set(child.id, entry.id);
        depthById.set(child.id, depth);
        attached.push(child);
      }
      if (attached.length === 0) continue;
      childrenById.set(entry.id, attached);
      for (let i = attached.length - 1; i >= 0; i--) stack.push(attached[i]);
    }
  }

  for (const entry of topLevel) attach(entry);
  // Rows still unreached belong to parent loops. Cut each loop at its first
  // row in source order and show that row at top level.
  for (const entry of entries) {
    if (parentById.has(entry.id)) continue;
    loopRowIds.push(entry.id);
    topLevel.push(entry);
    attach(entry);
  }

  const contextKeys = new Set(args.contextRowKeys ?? []);
  const entryById = new Map<RowId, Entry>();
  for (const entry of entries) entryById.set(entry.id, entry);
  const positionById = new Map<RowId, { index: number; size: number }>();
  setPositions(positionById, topLevel);
  for (const children of childrenById.values()) {
    setPositions(positionById, children);
  }

  const rows: ProtoRow[] = [];
  // `order` is depth-first, so a collapsed row's descendants are exactly the
  // rows that follow it with a greater depth.
  let hiddenBelowDepth: number | null = null;
  for (const id of order) {
    const depth = depthById.get(id)!;
    if (hiddenBelowDepth !== null) {
      if (depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = null;
    }
    const entry = entryById.get(id)!;
    const childCount = childrenById.get(id)?.length ?? 0;
    const expanded = childCount > 0 && isTreeRowExpanded(args.expansion, id);
    const position = positionById.get(id)!;
    const facts: TreeRowFacts = {
      depth,
      parentId: parentById.get(id)!,
      childCount,
      expanded,
      positionInSet: position.index,
      setSize: position.size,
      context: entry.row.kind === "data" && contextKeys.has(entry.row.rowKey),
    };
    rows.push(withFacts(entry.row, facts));
    if (childCount > 0 && !expanded) hiddenBelowDepth = depth;
  }

  const childIdsById = new Map<RowId, readonly RowId[]>();
  for (const [id, children] of childrenById) {
    childIdsById.set(
      id,
      children.map((child) => child.id),
    );
  }

  return {
    rows,
    structure: {
      order,
      parentById,
      childrenById: childIdsById,
      loopRowIds,
    },
  };
}

function setPositions(
  positionById: Map<RowId, { index: number; size: number }>,
  siblings: readonly Entry[],
): void {
  for (let i = 0; i < siblings.length; i++) {
    positionById.set(siblings[i].id, { index: i + 1, size: siblings.length });
  }
}

function withFacts(row: TreeProtoRow, tree: TreeRowFacts): ProtoRow {
  return row.kind === "data" ? { ...row, tree } : { ...row, tree };
}

export function treeStructuresEqual(
  a: TreeStructure | null,
  b: TreeStructure | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i++) {
    const id = a.order[i];
    if (id !== b.order[i]) return false;
    if (a.parentById.get(id) !== b.parentById.get(id)) return false;
  }
  if (a.loopRowIds.length !== b.loopRowIds.length) return false;
  for (let i = 0; i < a.loopRowIds.length; i++) {
    if (a.loopRowIds[i] !== b.loopRowIds[i]) return false;
  }
  return true;
}

export function treeRowFactsEqual(
  a: TreeRowFacts | undefined,
  b: TreeRowFacts | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.depth === b.depth &&
    a.parentId === b.parentId &&
    a.childCount === b.childCount &&
    a.expanded === b.expanded &&
    a.positionInSet === b.positionInSet &&
    a.setSize === b.setSize &&
    a.context === b.context
  );
}
