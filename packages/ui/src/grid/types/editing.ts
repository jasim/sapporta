import type { Coord } from "./identity";
import type { CellEditorStart } from "./schema";

export type EditingState = CellEditorStart & {
  coord: Coord;
};
