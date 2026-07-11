// Logical identity for the grid.
//
// Stores key on RowId and GridPath — stable logical identifiers that survive
// row reorders, insertions, and deletions. Array indices are render-time
// scratch only; the pipeline resolves an index from `rowIndexById` when one
// is needed (range bounds, scroll), but identity never shifts because a row
// moved in the array.
//
// RowKey is carried by every TreeNode. RowId composes GridPath, displayed-row
// kind, and RowKey into a globally unique handle. This means two rows in
// different levels or of different displayed kinds can share a RowKey.
//
// GridPath encoding: alternating (levelName, rowKey, levelName, rowKey, …,
// levelName) joined by `.`. Odd length. Root = `rootPath(rootLevelName)`;
// every step down composes via `childPath(parent, parentRowKey, childKey)`.
// Both level-name and rowKey segments may contain `.`, `#`, and `%`; all are
// percent-encoded inside the segment so the `.` separator stays unambiguous.
//
// Why rowKey-keyed instead of index-keyed? The path encoding survives
// sort/filter, ancestor mutation, and persistence (URL fragments, server
// logs). Index-based paths break under reorder, are unimplementable for
// REST sources (no raw blob to index into), and rot across data refreshes.
// RowId was already rowKey-keyed; GridPath now uses the same identity
// primitive, making the two halves of the identity model symmetric.
//
// The encoding also means cross-level child resolution (e.g.
// `runtime.materializedChildren`) can resolve via `rowKeyOfRowId(rowId)`
// (O(1) string slice) + map lookup instead of scanning row ids — a strict
// speedup on the per-row-render hot path.

import type { Brand } from "./brand";
import type { LevelRowKind } from "./level-row";

export type ColId = string;
export type RowKey = string;

// Logical position in a grid forest. Encoded as a `.`-separated alternation
// of level names and rowKeys, root level name first:
//   "orders"                                       root
//   "orders.ord-1.lines"                           children under order ord-1
//   "orders.ord-1.lines.ln-2.notes"                grandchildren
export type GridPath = Brand<string, "GridPath">;

// Logical row identity within a single GridPath. The encoded tuple contains the
// path, displayed-row kind, and row-local key. Arrays are scratch.
export type RowId = Brand<string, "RowId">;

export type Coord = { readonly rowId: RowId; readonly colId: ColId };

// Encode `%` first so that decode of e.g. `%2525` yields `%25` and not `%`.
// The literal characters that need protecting in a path segment are `.` (the
// path separator), `#` (the RowId tuple separator), and `%` (the encoding's own
// escape).
function encodePathSegment(segment: string): string {
  return segment
    .replaceAll("%", "%25")
    .replaceAll(".", "%2E")
    .replaceAll("#", "%23");
}

function decodePathSegment(segment: string): string {
  // Single pass: walk and replace only `%2E`, `%23`, and `%25`. Any other `%XX`-like
  // sequence in the input was never produced by encode and is left as-is.
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === "%" && i + 2 < segment.length) {
      const code = segment.slice(i + 1, i + 3);
      if (code === "2E" || code === "2e") {
        out += ".";
        i += 2;
        continue;
      }
      if (code === "25") {
        out += "%";
        i += 2;
        continue;
      }
      if (code === "23") {
        out += "#";
        i += 2;
        continue;
      }
    }
    out += segment[i];
  }
  return out;
}

/** Encodes a row key for use as one unambiguous path or row-id segment. */
export function encodeRowKeySegment(rowKey: RowKey): string {
  return encodePathSegment(rowKey);
}

/** Decodes a row-key segment produced by `encodeRowKeySegment`. */
export function decodeRowKeySegment(segment: string): RowKey {
  return decodePathSegment(segment);
}

function encodeLevelNameSegment(levelName: string): string {
  return encodePathSegment(levelName);
}

function decodeLevelNameSegment(segment: string): string {
  return decodePathSegment(segment);
}

/** Creates the only path registered during runtime construction. */
export function rootPath(rootLevelName: string): GridPath {
  return encodeLevelNameSegment(rootLevelName) as GridPath;
}

/**
 * Appends one parent-row and child-level edge to a path.
 * Use this helper instead of concatenating path strings.
 */
export function childPath(
  parent: GridPath,
  parentRowKey: RowKey,
  childKey: string,
): GridPath {
  if (parentRowKey === "") {
    throw new Error("childPath: empty rowKey is not permitted");
  }
  return `${parent}.${encodeRowKeySegment(parentRowKey)}.${encodeLevelNameSegment(childKey)}` as GridPath;
}

// One edge of a `GridPath` — the `(rowKey, childLevelName)` pair appended
// to a parent by `childPath(parent, rowKey, childLevelName)`.
export type PathEdge = { readonly rowKey: RowKey; readonly levelName: string };

// Structured view of a `GridPath`. `rootLevelName` is the first segment;
// `edges` is the ordered list of `(rowKey, childLevelName)` steps that
// descend from it. The last edge's `levelName` is the path's own level.
export type PathDecomposition = {
  readonly rootLevelName: string;
  readonly edges: readonly PathEdge[];
};

// Sole owner of `GridPath` parsing. Splits on `.`, validates the
// alternation parity, and decodes rowKey segments. Every other module
// asks for structured pieces via this function (or `trailingEdge`)
// rather than inspecting the raw string.
export function decomposePath(path: GridPath): PathDecomposition {
  const segs = (path as string).split(".");
  if (segs.length === 0 || segs.length % 2 !== 1) {
    throw new Error(`GridPath: malformed path "${path}"`);
  }
  const edges: PathEdge[] = [];
  for (let i = 1; i < segs.length; i += 2) {
    edges.push({
      rowKey: decodeRowKeySegment(segs[i]),
      levelName: decodeLevelNameSegment(segs[i + 1]),
    });
  }
  return { rootLevelName: decodeLevelNameSegment(segs[0]), edges };
}

// The trailing edge of a path: the parent path plus the
// `(parentRowKey, childLevelName)` pair that produced `path` from it.
// Returns `null` for the root path. Inverse of `childPath` for a single
// step, where `parseChildPath` is the inverse for a known parent.
//
// Goes through `decomposePath` so the parity / malformed-path check has
// exactly one definition; the parent path is reconstructed by trimming
// the last two raw segments to avoid re-encoding rowKeys we just decoded.
export function trailingEdge(path: GridPath): {
  parentPath: GridPath;
  parentRowKey: RowKey;
  childLevelName: string;
} | null {
  const decomp = decomposePath(path);
  if (decomp.edges.length === 0) return null;
  const last = decomp.edges[decomp.edges.length - 1];
  const raw = path as string;
  const lastDot = raw.lastIndexOf(".");
  const parentPath = raw.slice(
    0,
    raw.lastIndexOf(".", lastDot - 1),
  ) as GridPath;
  return {
    parentPath,
    parentRowKey: last.rowKey,
    childLevelName: last.levelName,
  };
}

// Inverse of `childPath`. Given a parent path and one of its descendants
// (exactly one level deep), returns the parent rowKey and child level name.
// Centralizes the path encoding so callers do not parse strings themselves.
// Returns null when `child` is not a direct descendant of `parent` — either
// `child` does not start with `parent + "."`, or the tail is malformed
// (missing the child-key segment, or contains additional `.` separators
// indicating a deeper descendant rather than a direct child).
export function parseChildPath(
  parent: GridPath,
  child: GridPath,
): { rowKey: RowKey; childKey: string } | null {
  if (!child.startsWith(`${parent}.`)) return null;
  const tail = child.slice(parent.length + 1);
  const firstDot = tail.indexOf(".");
  if (firstDot < 0) return null;
  // Direct descendant means exactly two segments after the parent prefix:
  // `<encoded rowKey>.<childKey>`. A second dot in `tail` means the path
  // points at a grandchild or deeper.
  if (tail.indexOf(".", firstDot + 1) >= 0) return null;
  const rowKey = decodeRowKeySegment(tail.slice(0, firstDot));
  const childKey = decodeLevelNameSegment(tail.slice(firstDot + 1));
  return { rowKey, childKey };
}

/** Creates an identity for any displayed row kind within one path. */
export function makeLevelRowId(
  path: GridPath,
  kind: LevelRowKind,
  rowKey: RowKey,
): RowId {
  if (rowKey === "") {
    throw new Error("makeLevelRowId: empty rowKey is not permitted");
  }
  return `${path}#${kind}#${encodeRowKeySegment(rowKey)}` as RowId;
}

/** Creates the source-backed data-row identity for a path and row key. */
export function makeRowId(path: GridPath, rowKey: RowKey): RowId {
  return makeLevelRowId(path, "data", rowKey);
}

/** Returns a draft row's local key, or `null` for every other row kind. */
export function phantomKeyFromDisplayedRowId(rowId: RowId): RowKey | null {
  const parsed = parseRowId(rowId);
  return parsed.kind === "phantom" ? parsed.rowKey : null;
}

/** Reports whether a displayed row id belongs to a draft row. */
export function isDisplayedPhantomRowId(rowId: RowId): boolean {
  return phantomKeyFromDisplayedRowId(rowId) !== null;
}

/** Returns the exact grid path encoded in a row identity. */
export function pathOfRowId(id: RowId): GridPath {
  return parseRowId(id).path;
}

/** Returns the path-local row key encoded in a row identity. */
export function rowKeyOfRowId(id: RowId): RowKey {
  return parseRowId(id).rowKey;
}

/** Returns the displayed row kind encoded in a row identity. */
export function kindOfRowId(id: RowId): LevelRowKind {
  return parseRowId(id).kind;
}

function parseRowId(id: RowId): {
  path: GridPath;
  kind: LevelRowKind;
  rowKey: RowKey;
} {
  const first = id.indexOf("#");
  const second = first < 0 ? -1 : id.indexOf("#", first + 1);
  if (first <= 0 || second <= first + 1 || id.indexOf("#", second + 1) >= 0) {
    throw new Error(`Malformed RowId: ${id}`);
  }
  const kind = id.slice(first + 1, second);
  if (!isLevelRowKind(kind)) throw new Error(`Malformed RowId: ${id}`);
  const rowKey = decodeRowKeySegment(id.slice(second + 1));
  if (rowKey === "") throw new Error(`Malformed RowId: ${id}`);
  return {
    path: id.slice(0, first) as GridPath,
    kind,
    rowKey,
  };
}

function isLevelRowKind(value: string): value is LevelRowKind {
  switch (value) {
    case "data":
    case "rollup":
    case "opening":
    case "closing":
    case "subtotal":
    case "footer":
    case "phantom":
      return true;
    default:
      return false;
  }
}

/** Compares two cell coordinates by row and column identity. */
export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.rowId === b.rowId && a.colId === b.colId;
}

// The canonical location of the live focus across the whole grid. There is
// at most one. Owned by the cursor manager; the coordinator stores it and the
// controller for `path` mirrors `(rowId, colId)` as `liveCellFocus`.
export type CellCursor = {
  readonly path: GridPath;
  readonly rowId: RowId;
  readonly colId: ColId;
};

/** Compares nullable global cell cursors by path, row, and column identity. */
export function cursorEqual(
  a: CellCursor | null,
  b: CellCursor | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.rowId === b.rowId && a.colId === b.colId;
}
