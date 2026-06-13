// Capabilities replace kind-checking in the interaction layer.
//
// Instead of scattering `row.kind === "footer" ? ... : ...` across the
// keyboard handler, selection logic, and edit-start code, every check
// goes through `capabilitiesFor(kind)`. Navigation skips non-focusable
// rows; edit-start blocks on non-editable; cell range selection uses
// `selectable`; row operation selection uses `rowSelectable`; expand chevron
// renders iff `canExpand && row.hasChildren`. There is no other branching on
// `kind` in the interaction layer.
//
// `selectable` and `rowSelectable` are intentionally separate. A subtotal can
// participate in a visual cell range but should not be a target for row
// operations such as delete/export. DisplayedRows copies `rowSelectable` onto
// each row so row-selection helpers consume one stable fact instead of
// re-deriving capabilities later.
//
// Adding a new LevelRow kind without updating this map is a compile-time
// type error (and a runtime throw if TS is bypassed).

import type { LevelRow, LevelRowKind } from "./level-row";

export type RowCapabilities = {
  editable: boolean;
  focusable: boolean;
  selectable: boolean;
  rowSelectable: boolean;
  hasContextMenu: boolean;
  canExpand: boolean;
};

// Exhaustive switch with throwing default. Adding a new LevelRow kind without
// extending this map is a type error at compile time and a runtime throw if
// we are wrong.
export function capabilitiesFor(kind: LevelRowKind): RowCapabilities {
  switch (kind) {
    case "data":
      return {
        editable: true,
        focusable: true,
        selectable: true,
        rowSelectable: true,
        hasContextMenu: true,
        canExpand: true,
      };
    case "rollup":
      return {
        editable: true,
        focusable: true,
        selectable: true,
        rowSelectable: true,
        hasContextMenu: true,
        canExpand: false,
      };
    case "opening":
    case "closing":
      return {
        editable: false,
        focusable: true,
        selectable: false,
        rowSelectable: false,
        hasContextMenu: false,
        canExpand: false,
      };
    case "subtotal":
      return {
        editable: false,
        focusable: true,
        selectable: true,
        rowSelectable: false,
        hasContextMenu: false,
        canExpand: false,
      };
    case "footer":
      return {
        editable: false,
        focusable: false,
        selectable: false,
        rowSelectable: false,
        hasContextMenu: false,
        canExpand: false,
      };
    case "phantom":
      return {
        editable: true,
        focusable: true,
        selectable: true,
        rowSelectable: true,
        hasContextMenu: false,
        canExpand: false,
      };
    default: {
      const _exhaustive: never = kind;
      throw new Error(`capabilitiesFor: unhandled kind ${_exhaustive}`);
    }
  }
}

export function capabilitiesOf(row: LevelRow): RowCapabilities {
  return capabilitiesFor(row.kind);
}
