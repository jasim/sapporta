// The universal row shape and the input nodes it comes from.
//
// Displayed-row derivation emits a uniform `LevelRow` regardless of source
// kind (data, rollup, bracket, footer, phantom). Consumers and renderers
// branch on `kind` for display; the grid's interaction layer branches only
// through `capabilitiesFor(kind)` — never on `kind` directly. This keeps the
// keyboard handler, selection logic, and edit-start checks from sprouting
// kind-specific conditionals.
//
// Adding a new `LevelRowKind` without updating `capabilitiesFor` is a
// compile-time type error (and a runtime throw if TS is bypassed).
//
// `DisplayedRows` is the full row-content read model. It provides O(1)
// lookup by RowId (rowById) and by position (rowIndexById) because the
// keyboard handler, range selection, and scroll routing all need both.
//
// `DisplayedRowSequence` is deliberately thinner: body components need only
// the ordered row references required to mount row shells. Keeping sequence
// identity separate from row-object identity lets a cell edit wake only that
// row's subscriber instead of remapping the whole body.

import type { ColId, RowId, RowKey } from "./identity";

export type FooterRow = {
  // Stable key inside its scope — a level snapshot's footerRows array, or a
  // parent node's childFooterRows for that child level.
  readonly rowKey: RowKey;
  readonly columns: Readonly<Record<ColId, unknown>>;
};

export type PhantomRow = {
  readonly rowKey: RowKey;
  readonly columns: Readonly<Record<ColId, unknown>>;
  readonly state: PhantomRowState;
};

export type PhantomRowState =
  | { readonly kind: "editing" }
  | { readonly kind: "saving" }
  | { readonly kind: "failed"; readonly reason: string };

export type PhantomRowsConfig =
  | false
  | {
      readonly isBlank?: (columns: Readonly<Record<ColId, unknown>>) => boolean;
      readonly makeRowKey?: (context: {
        readonly path: import("./identity").GridPath;
        readonly existing: readonly PhantomRow[];
      }) => RowKey;
    };

export type LevelOptions = {
  readonly defaultCollapsed?: boolean;
  readonly allowPhantoms?: boolean;
};

export type TreeNode = {
  readonly rowKey: RowKey;
  readonly levelName: string;
  readonly columns: Readonly<Record<ColId, unknown>>;
  readonly rollup?: Readonly<Record<ColId, unknown>>;
  readonly children?: Readonly<Record<string, TreeNode | readonly TreeNode[]>>;
  readonly childFooterRows?: Readonly<Record<string, readonly FooterRow[]>>;
  readonly kind?: "opening" | "closing" | "subtotal";
};

export type LevelRowKind =
  | "data"
  | "rollup"
  | "opening"
  | "closing"
  | "subtotal"
  | "footer"
  | "phantom";

// Discriminated union: render and capability-checks branch on `kind`,
// the interaction layer branches only via capabilitiesFor(kind).
export type LevelRow =
  | {
      readonly kind: "data";
      readonly id: RowId;
      readonly rowSelectable: boolean;
      readonly columns: Readonly<Record<ColId, unknown>>;
      readonly hasChildren: boolean;
      readonly source: TreeNode;
    }
  | {
      readonly kind: "rollup";
      readonly id: RowId;
      readonly rowSelectable: boolean;
      readonly columns: Readonly<Record<ColId, unknown>>;
      readonly source: TreeNode;
    }
  | {
      readonly kind: "opening" | "closing" | "subtotal";
      readonly id: RowId;
      readonly rowSelectable: boolean;
      readonly columns: Readonly<Record<ColId, unknown>>;
      readonly source: TreeNode;
    }
  | {
      readonly kind: "footer";
      readonly id: RowId;
      readonly rowSelectable: boolean;
      readonly columns: Readonly<Record<ColId, unknown>>;
      readonly source: FooterRow;
    }
  | {
      readonly kind: "phantom";
      readonly id: RowId;
      readonly rowSelectable: boolean;
      readonly columns: Readonly<Record<ColId, unknown>>;
      readonly source: PhantomRow;
    };

export type TreeBackedLevelRow = Extract<
  LevelRow,
  { kind: "data" | "rollup" | "opening" | "closing" | "subtotal" }
>;

export type FooterLevelRow = Extract<LevelRow, { kind: "footer" }>;

export function isTreeBackedRow(row: LevelRow): row is TreeBackedLevelRow {
  switch (row.kind) {
    case "data":
    case "rollup":
    case "opening":
    case "closing":
    case "subtotal":
      return true;
    case "footer":
    case "phantom":
      return false;
  }
}

export function treeNodeForRow(row: LevelRow): TreeNode | null {
  return isTreeBackedRow(row) ? row.source : null;
}

export function isFooterRow(row: LevelRow): row is FooterLevelRow {
  return row.kind === "footer";
}

export function footerSourceForRow(row: LevelRow): FooterRow | null {
  return isFooterRow(row) ? row.source : null;
}

export type DisplayedRowRef = {
  readonly id: RowId;
  readonly kind: LevelRowKind;
};

export type DisplayedRowSequence = {
  readonly rows: readonly DisplayedRowRef[];
};

export type DisplayedRows = {
  readonly rows: readonly LevelRow[];
  readonly rowById: ReadonlyMap<RowId, LevelRow>;
  readonly rowIndexById: ReadonlyMap<RowId, number>;
};
