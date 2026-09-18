import { buildDataRows } from "../pipeline/stages/build-data";
import { buildDisplayed } from "../pipeline/stages/build-displayed";
import { withFooters } from "../pipeline/stages/with-footers";
import { withOpeningClosing } from "../pipeline/stages/with-opening-closing";
import { withPhantoms } from "../pipeline/stages/with-phantoms";
import { withRollup } from "../pipeline/stages/with-rollup";
import { withRowIds } from "../pipeline/stages/with-row-ids";
import {
  treeRowFactsEqual,
  treeStructuresEqual,
  withTree,
} from "../pipeline/stages/with-tree";
import type { ColId } from "../types/identity";
import {
  treeFactsOf,
  type DisplayedRows,
  type DisplayedRowSequence,
  type FooterRow,
  type LevelRow,
} from "../types/level-row";
import { initialTreeExpansion, type TreeStructure } from "../types/tree";
import type { DisplayedRowsInput, DisplayedRowsState } from "./types";
import {
  assertUniqueDisplayedRowIds,
  assertUniqueTreeNodeRowKeys,
} from "../row-identity";

const EMPTY_FOOTERS: FooterRow[] = [];

// Pure `DisplayedRowsInput` -> displayed-row read models derivation.
//
// This is the single production place where source rows become body rows. The
// order matters because each stage answers a different domain question:
// source nodes become data rows, tree structure adds rollups/brackets,
// server footers join the body, local phantoms join only after real rows,
// and row ids are assigned last from the final path-relative order.
//
// A tree level (`LevelSchema.tree`) takes a different route:
// `buildDataRows → withTree → withFooters → withRowIds`. `withTree` places
// drafts itself, under the parent their parent-key field names, so in a tree
// level drafts come before footers.
//
// `previous` is only for identity preservation. It must never change the
// semantics of the output; it only lets subscribers avoid waking when the same
// logical rows survive a source or phantom refresh.
export function deriveDisplayedRowsState(
  input: DisplayedRowsInput,
  previous?: DisplayedRowsState,
): DisplayedRowsState {
  const { rows: identifiedRows, tree: derivedTree } =
    deriveIdentifiedRows(input);
  const tree =
    previous && treeStructuresEqual(previous.tree, derivedTree)
      ? previous.tree
      : derivedTree;
  const displayedRowSequence = reuseDisplayedRowSequenceIfUnchanged(
    identifiedRows,
    previous?.displayedRowSequence,
  );
  const rowIdentityStableRows = reuseUnchangedDisplayedRowObjects(
    identifiedRows,
    previous?.displayedRows,
  );
  const displayedRows = reuseDisplayedRowsSnapshotIfRowObjectsUnchanged(
    rowIdentityStableRows,
    previous?.displayedRows,
  );

  if (
    previous &&
    previous.displayedRows === displayedRows &&
    previous.displayedRowSequence === displayedRowSequence &&
    previous.tree === tree
  ) {
    return previous;
  }
  return { displayedRows, displayedRowSequence, tree };
}

function deriveIdentifiedRows(input: DisplayedRowsInput): {
  rows: LevelRow[];
  tree: TreeStructure | null;
} {
  const { path, schema, sourceSnapshot, phantomRows } = input;
  const footerRows = sourceSnapshot.footerRows ?? EMPTY_FOOTERS;
  assertUniqueTreeNodeRowKeys(
    sourceSnapshot.nodes,
    `Displayed rows at path "${path}"`,
  );
  const dataRows = buildDataRows(sourceSnapshot.nodes, schema.options);
  if (schema.tree) {
    const tree = withTree({
      path,
      rows: dataRows,
      phantoms: phantomRows,
      options: schema.options,
      parentKeyField: schema.tree.parentKeyField,
      expansion:
        input.viewState.treeExpansion ?? initialTreeExpansion(schema.tree),
      contextRowKeys: sourceSnapshot.treeContextRowKeys,
    });
    const identified = withRowIds(withFooters(tree.rows, footerRows), path);
    assertUniqueDisplayedRowIds(identified, `Displayed rows at path "${path}"`);
    return { rows: identified, tree: tree.structure };
  }
  const rollupRows = withRollup(dataRows);
  const bracketedRows = withOpeningClosing(rollupRows);
  const rowsWithFooters = withFooters(bracketedRows, footerRows);
  const rowsWithPhantoms = withPhantoms(
    rowsWithFooters,
    phantomRows,
    schema.options,
  );
  const identified = withRowIds(rowsWithPhantoms, path);
  assertUniqueDisplayedRowIds(identified, `Displayed rows at path "${path}"`);
  return { rows: identified, tree: null };
}

export function buildDisplayedRowSequence(
  rows: readonly LevelRow[],
): DisplayedRowSequence {
  return {
    rows: rows.map((row) => ({ id: row.id, kind: row.kind })),
  };
}

export function reuseDisplayedRowSequenceIfUnchanged(
  rows: readonly LevelRow[],
  previous?: DisplayedRowSequence,
): DisplayedRowSequence {
  if (!previous || previous.rows.length !== rows.length) {
    return buildDisplayedRowSequence(rows);
  }

  for (let i = 0; i < rows.length; i++) {
    const a = previous.rows[i];
    const b = rows[i];
    if (a.id !== b.id || a.kind !== b.kind) {
      return buildDisplayedRowSequence(rows);
    }
  }

  return previous;
}

// Context: the derivation pipeline rebuilds `LevelRow` objects per invalidation.
// Purpose: swap unchanged rows back to their previous object identities.
// Value: row subscribers wake only when that row's visible facts change.
function reuseUnchangedDisplayedRowObjects(
  rows: readonly LevelRow[],
  previous?: DisplayedRows,
): readonly LevelRow[] {
  if (!previous || previous.rowById.size === 0) return rows;

  let changed = previous.rows.length !== rows.length;
  const next = rows.map((row, index) => {
    const prior = previous.rowById.get(row.id);
    if (prior && canReuseDisplayedRowObject(prior, row)) {
      if (previous.rows[index] !== prior) changed = true;
      return prior;
    }
    changed = true;
    return row;
  });

  return changed ? next : previous.rows;
}

// Row object identity is the row-level subscription contract. A `GridRow`
// subscribed to one row should wake when that row's visible facts change, but
// not because a sibling moved, a phantom was appended, or the source emitted a
// fresh object graph with equal cell values. The checks here define "same
// visible row" for rendering purposes.
function canReuseDisplayedRowObject(
  previous: LevelRow,
  next: LevelRow,
): boolean {
  if (previous.id !== next.id) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.rowSelectable !== next.rowSelectable) return false;
  if (previous.source !== next.source) return false;
  if (
    previous.kind === "data" &&
    next.kind === "data" &&
    previous.hasChildren !== next.hasChildren
  ) {
    return false;
  }
  // A tree row wakes when its chevron, depth, position, or context flag
  // changes, and not when a sibling elsewhere in the tree does.
  if (!treeRowFactsEqual(treeFactsOf(previous), treeFactsOf(next))) {
    return false;
  }
  return (
    previous.columns === next.columns ||
    columnValuesEqual(previous.columns, next.columns)
  );
}

function columnValuesEqual(
  a: Readonly<Record<ColId, unknown>>,
  b: Readonly<Record<ColId, unknown>>,
): boolean {
  const aKeys = Object.keys(a) as ColId[];
  const bKeys = Object.keys(b) as ColId[];
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

// Context: `DisplayedRows` wraps rows with lookup maps for runtime callers.
// Purpose: reuse the wrapper when the ordered row object list is unchanged.
// Value: no-op invalidations keep stable maps and avoid waking broad readers.
function reuseDisplayedRowsSnapshotIfRowObjectsUnchanged(
  rows: readonly LevelRow[],
  previous?: DisplayedRows,
): DisplayedRows {
  if (!previous || previous.rows.length !== rows.length) {
    return buildDisplayed(rows);
  }
  for (let i = 0; i < rows.length; i++) {
    if (previous.rows[i] !== rows[i]) return buildDisplayed(rows);
  }
  return previous;
}
