import { kindOfRowId, pathOfRowId } from "../types/identity";
import type {
  LevelRow,
  LevelRowKind,
  LevelRowOfKind,
} from "../types/level-row";
import type { GridLevelRuntime } from "./grid-level-runtime";

/** A live, displayed row resolved from the runtime's global active cursor. */
export type GridActiveRow<Kind extends LevelRowKind = LevelRowKind> =
  Kind extends LevelRowKind
    ? {
        readonly row: LevelRowOfKind<Kind>;
        readonly level: GridLevelRuntime;
      }
    : never;

export function createGridActiveRow(
  level: GridLevelRuntime,
  row: LevelRow,
): GridActiveRow {
  if (kindOfRowId(row.id) !== row.kind) {
    throw new Error(
      `GridRuntime: row id "${row.id}" does not encode row kind "${row.kind}".`,
    );
  }
  if (pathOfRowId(row.id) !== level.path) {
    throw new Error(
      `GridRuntime: row "${row.id}" does not belong to path "${level.path}".`,
    );
  }
  return Object.freeze({ row, level }) as GridActiveRow;
}
