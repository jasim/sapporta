import type {
  GridActiveRow,
  GridLevelRuntime,
  GridRuntime,
  LevelRow,
  LevelRowOfKind,
  RowActivationTrigger,
} from "@sapporta/grid";
import type { TGridLevelId, TGridRowsByLevel } from "./tgrid-types";

type TGridActiveRowForKind<
  RowsByLevel extends TGridRowsByLevel,
  LevelId extends TGridLevelId<RowsByLevel>,
  Kind extends LevelRow["kind"],
> = Omit<LevelRowOfKind<Kind>, "columns"> & {
  levelId: LevelId;
  values: Kind extends "data"
    ? Readonly<RowsByLevel[LevelId]>
    : Readonly<Partial<RowsByLevel[LevelId]>>;
  level: GridLevelRuntime;
  runtime: GridRuntime;
};

/**
 * The TGrid row currently carrying application context.
 *
 * Check `kind` before treating `values` as a saved record. Data rows have the
 * complete level row type; drafts, rollups, and structural rows expose the
 * partial values they actually display. `id` is the row identity, and
 * `level.path` is its concrete runtime location.
 */
export type TGridActiveRow<RowsByLevel extends TGridRowsByLevel> = {
  [LevelId in TGridLevelId<RowsByLevel>]: {
    [Kind in LevelRow["kind"]]: TGridActiveRowForKind<
      RowsByLevel,
      LevelId,
      Kind
    >;
  }[LevelRow["kind"]];
}[TGridLevelId<RowsByLevel>];

export type TGridRowActivatedEvent<RowsByLevel extends TGridRowsByLevel> = {
  activeRow: TGridActiveRow<RowsByLevel>;
  trigger: RowActivationTrigger;
};

export function projectTGridActiveRow<RowsByLevel extends TGridRowsByLevel>(
  active: GridActiveRow,
  runtime: GridRuntime,
  levelId: TGridLevelId<RowsByLevel>,
): TGridActiveRow<RowsByLevel> {
  const { columns, ...row } = active.row;
  const projection = {
    ...row,
    levelId,
    values: columns,
    level: active.level,
    runtime,
  };

  // This adapter is the one boundary where runtime schemas become the
  // session's RowsByLevel mapping. Keep the switch exhaustive so the cast
  // cannot silently omit a future core row kind.
  switch (active.row.kind) {
    case "data":
    case "rollup":
    case "opening":
    case "closing":
    case "subtotal":
    case "footer":
    case "phantom":
      return projection as TGridActiveRow<RowsByLevel>;
    default:
      return assertNever(active.row);
  }
}

function assertNever(value: never): never {
  throw new Error(`TGridSession: unsupported active row ${String(value)}`);
}
