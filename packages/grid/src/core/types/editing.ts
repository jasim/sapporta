import type { Coord } from "./identity";
import type { CellEditorStart } from "./schema";

export type EditingState = {
  readonly coord: Coord;
  readonly editStart: CellEditorStart;
};
