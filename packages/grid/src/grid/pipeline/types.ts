import type { ColId, RowKey } from "../types/identity";
import type { FooterRow, PhantomRow, TreeNode } from "../types/level-row";

// ProtoRow is the intermediate shape carried through pipeline stages.
// It mirrors LevelRow but carries `rowKey` instead of the final `id: RowId`;
// `withRowIds` is the seam that resolves `rowKey + path → RowId`.
export type ProtoRow =
  | {
      kind: "data";
      rowKey: RowKey;
      columns: Record<ColId, unknown>;
      hasChildren: boolean;
      source: TreeNode;
    }
  | {
      kind: "rollup";
      rowKey: RowKey;
      columns: Record<ColId, unknown>;
      source: TreeNode;
    }
  | {
      kind: "opening" | "closing" | "subtotal";
      rowKey: RowKey;
      columns: Record<ColId, unknown>;
      source: TreeNode;
    }
  | {
      kind: "footer";
      rowKey: RowKey;
      columns: Record<ColId, unknown>;
      source: FooterRow;
    }
  | {
      kind: "phantom";
      rowKey: RowKey;
      columns: Record<ColId, unknown>;
      source: PhantomRow;
    };

// Sort is the only per-column concern the grid takes a position on: a
// column id plus a direction. Anything richer (multi-key sort priorities
// with collation, locale-aware comparators, null ordering rules) is the
// host's domain — `withSort` calls `makeRowComparator` over the column
// schema and the host can override per-column comparators there.
export type SortDescriptor = { colId: ColId; direction: "asc" | "desc" };

// Filter is the OPPOSITE position: the grid takes no opinion at all. There
// is no grid-level filter grammar — no operator names (`eq`/`like`/`gt`),
// no AND/OR group structure, no free-text "search" slot, no column-keyed
// predicate map. Every host's wire grammar is different, and the grid's
// job at filter-time is exactly one thing: walk rows and ask "keep this?"
// `RowPredicate` is the answer. The host owns the grammar; the host owns
// the compiler from grammar → predicate (the source's `compileFilter`);
// the grid calls the predicate without inspecting how it was built.
//
// This is the trust boundary. The grid does not validate, introspect, or
// recover from a malformed `RowPredicate` — if it throws, that's a host
// bug, not a grid concern.
export type RowPredicate = (columns: Record<ColId, unknown>) => boolean;

// What a single stage looks like. Stages are pure, identity-preserving
// when they would emit the same output.
export type Stage<I, O> = (input: I) => O;
