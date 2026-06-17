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
  rowKey: RowKey;
  columns: Record<ColId, unknown>;
};

export type PhantomRow = {
  rowKey: RowKey;
  columns: Record<ColId, unknown>;
  state: PhantomRowState;
};

export type PhantomRowState =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "failed"; reason: string };

export type PhantomRowsConfig =
  | false
  | {
      isBlank?: (columns: Record<ColId, unknown>) => boolean;
      makeRowKey?: (context: {
        path: import("./identity").GridPath;
        existing: readonly PhantomRow[];
      }) => RowKey;
    };

export type LevelOptions = {
  // Map a TreeNode + its local index (within siblings of the same level) to a stable RowKey.
  // Default: `${localIdx}` — fine for tables with stable arrays, replaceable when the
  // consumer has a real PK and wants identity to survive reorders.
  rowKey?: (node: TreeNode, localIdx: number) => RowKey;
  defaultCollapsed?: boolean;
  allowPhantoms?: boolean;
};

export type TreeNode = {
  rowKey?: RowKey;
  levelName: string;
  columns: Record<ColId, unknown>;
  rollup?: Record<ColId, unknown>;
  children?: Record<string, TreeNode | TreeNode[]>;
  childFooterRows?: Record<string, FooterRow[]>;
  kind?: "opening" | "closing" | "subtotal";
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
      kind: "data";
      id: RowId;
      rowSelectable: boolean;
      columns: Record<ColId, unknown>;
      hasChildren: boolean;
      source: TreeNode;
    }
  | {
      kind: "rollup";
      id: RowId;
      rowSelectable: boolean;
      columns: Record<ColId, unknown>;
      source: TreeNode;
    }
  | {
      kind: "opening" | "closing" | "subtotal";
      id: RowId;
      rowSelectable: boolean;
      columns: Record<ColId, unknown>;
      source: TreeNode;
    }
  | {
      kind: "footer";
      id: RowId;
      rowSelectable: boolean;
      columns: Record<ColId, unknown>;
      source: FooterRow;
    }
  | {
      kind: "phantom";
      id: RowId;
      rowSelectable: boolean;
      columns: Record<ColId, unknown>;
      source: PhantomRow;
    };

export type DisplayedRowRef = {
  id: RowId;
  kind: LevelRowKind;
};

export type DisplayedRowSequence = {
  rows: readonly DisplayedRowRef[];
};

export type DisplayedRows = {
  rows: LevelRow[];
  rowById: Map<RowId, LevelRow>;
  rowIndexById: Map<RowId, number>;
};
