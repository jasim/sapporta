import type { LevelSnapshot } from "../data-sources/types";
import type { GridPath } from "../types/identity";
import type {
  DisplayedRows,
  DisplayedRowSequence,
  PhantomRow,
} from "../types/level-row";
import type { LevelSchema } from "../types/schema";

// Reserved for body-owned UI state that changes what rows exist or where
// they appear, but that is not source data and not transient interaction
// state. Today no such state exists. Keeping the type explicit makes the
// boundary visible: selection/focus/editing belong to the controller, while
// only row-shape inputs belong in `DisplayedRowsInput`.
export type DisplayedRowsViewState = Record<string, never>;

// The complete recipe for one path's renderable body rows.
//
// Think of this as the level's read model, not as a partial event payload:
// source data, schema rules, author-local phantom rows, and body view state
// are gathered before derivation starts. The deriver must not read from the
// runtime, the phantom channel, React, or a controller. That rule keeps
// invalidation simple: when any one of these ingredients changes, the runtime
// asks the store to re-read the whole recipe and derive a new `DisplayedRows`
// snapshot from first principles.
export type DisplayedRowsInput = {
  readonly path: GridPath;
  readonly schema: LevelSchema;
  readonly sourceSnapshot: LevelSnapshot;
  readonly phantomRows: readonly PhantomRow[];
  readonly viewState: DisplayedRowsViewState;
};

// One path's cached data-plane snapshots. The full row model and the
// row-sequence model are derived from the same identified row order, but their
// identities answer different questions: "did content change?" vs. "did the
// body need to remap row shells?"
export type DisplayedRowsState = {
  readonly displayedRows: DisplayedRows;
  readonly displayedRowSequence: DisplayedRowSequence;
};

// A reason is intentionally diagnostic, not semantic input. The store always
// recomputes from `DisplayedRowsInput`; it never tries to patch itself from
// the event that woke it up. This prevents "source changed" and "phantom
// changed" from becoming two competing mini-derivations.
export type DisplayedRowsInvalidationReason =
  { type: "source" } | { type: "phantoms" } | { type: "view" };
