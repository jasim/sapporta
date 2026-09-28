import type {
  CellEditGesture,
  GridCopyColumn,
  GridLevelRuntime,
  GridRuntime,
} from "@sapporta/grid";
import type { ComponentType } from "react";
import type { ColumnWidth } from "@sapporta/grid/column-preset";
import type {
  RowFieldName,
  TGridLevelId,
  TGridRowsByLevel,
} from "./tgrid-types";
import type {
  TGridCellEditorContext,
  TGridCellActivation,
  TGridCellRenderContext,
  TGridCellWriteHandler,
  TGridColumnContext,
} from "./tgrid-cell-context";

// Level-scoped builder input types used to describe visible columns.
// Every returned spec is attached to the same level id and typed row shape.
// These options are for real table fields and keep row-level typing intact.

export type TGridColumnCopyBehavior<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  TValue,
> = (context: {
  levelId: LevelId;
  level: GridLevelRuntime;
  column: TGridColumnContext<RowsByLevel[LevelId]>;
  rows: readonly Readonly<RowsByLevel[LevelId]>[];
  values: readonly TValue[];
  runtime: GridRuntime;
  appServices: AppServices;
}) =>
  | readonly GridCopyColumn<Readonly<RowsByLevel[LevelId]>>[]
  | Promise<readonly GridCopyColumn<Readonly<RowsByLevel[LevelId]>>[]>;

export type TableColumnOptions<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> = {
  label?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  edit?:
    | "default"
    | "none"
    | {
        editor?:
          | "default"
          | ComponentType<
              TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K>
            >;
        startsOn?: readonly CellEditGesture[];
      };
  activation?: TGridCellActivation<RowsByLevel, AppServices, LevelId>;
  renderCell?: ComponentType<
    TGridCellRenderContext<RowsByLevel, AppServices, LevelId>
  >;
  copy?: TGridColumnCopyBehavior<
    RowsByLevel,
    AppServices,
    LevelId,
    RowsByLevel[LevelId][K]
  >;
  saveCellValue?: TGridCellWriteHandler<RowsByLevel, AppServices, LevelId, K>;
};

// Optional overrides for computed columns that are not part of table API.
// Useful for actions/labels and editor UI not mapped to a physical DB field.
export type ClientColumnOptions<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  label?: string;
  width?: number | ColumnWidth;
  edit?:
    | "default"
    | "none"
    | {
        editor?:
          | "default"
          | ComponentType<
              TGridCellEditorContext<
                RowsByLevel,
                AppServices,
                LevelId,
                RowFieldName<RowsByLevel[LevelId]>
              >
            >;
        startsOn?: readonly CellEditGesture[];
      };
  activation?: TGridCellActivation<RowsByLevel, AppServices, LevelId>;
  renderCell?: ComponentType<
    TGridCellRenderContext<RowsByLevel, AppServices, LevelId>
  >;
  copy?: TGridColumnCopyBehavior<RowsByLevel, AppServices, LevelId, unknown>;
};

// Spec that binds a real table field to a level's column list.
// Keeps editor/rendering tightly typed to one field and one level id.
export type TGridTableColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]> = RowFieldName<
    RowsByLevel[LevelId]
  >,
> = {
  kind: "table";
  columnName: K;
  options?: TableColumnOptions<RowsByLevel, AppServices, LevelId, K>;
};

// Spec for a client-managed column added by user code.
// These columns do not map to table storage but can still render and edit.
export type TGridClientColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  kind: "client";
  id: string;
  options: ClientColumnOptions<RowsByLevel, AppServices, LevelId>;
};

// Options for some of a level's table columns, keyed by column name.
export type TableColumnOptionsByName<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  readonly [K in RowFieldName<RowsByLevel[LevelId]>]?: TableColumnOptions<
    RowsByLevel,
    AppServices,
    LevelId,
    K
  >;
};

// Spec that expands to every visible table column the list does not name
// with `table(...)`, in schema order. `exclude` leaves columns out;
// `columnOptions` changes some of the added columns without moving them.
export type TGridRemainingTableColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  kind: "remainingTable";
  exclude?: readonly RowFieldName<RowsByLevel[LevelId]>[];
  columnOptions?: TableColumnOptionsByName<RowsByLevel, AppServices, LevelId>;
};

// Union member for any table-backed field spec.
// Used so the builder can infer correct column names per level row shape.
export type TGridAnyTableColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  [K in RowFieldName<RowsByLevel[LevelId]>]: TGridTableColumnSpec<
    RowsByLevel,
    AppServices,
    LevelId,
    K
  >;
}[RowFieldName<RowsByLevel[LevelId]>];

// Union of all possible column specs for a level.
// A valid level column array is built from this one discriminated union.
export type TGridColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> =
  | TGridAnyTableColumnSpec<RowsByLevel, AppServices, LevelId>
  | TGridClientColumnSpec<RowsByLevel, AppServices, LevelId>
  | TGridRemainingTableColumnSpec<RowsByLevel, AppServices, LevelId>;

// Builder surface exposed by `columns(...)`.
// `table`, `client`, and `remainingTable` return ordered column spec values.
export type TGridColumnsBuilder<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  // Add a table field column for this level.
  table<K extends RowFieldName<RowsByLevel[LevelId]>>(
    columnName: K,
    options?: TableColumnOptions<RowsByLevel, AppServices, LevelId, K>,
  ): TGridTableColumnSpec<RowsByLevel, AppServices, LevelId, K>;
  // Add a computed, client-owned column for this level.
  client(
    id: string,
    options: ClientColumnOptions<RowsByLevel, AppServices, LevelId>,
  ): TGridClientColumnSpec<RowsByLevel, AppServices, LevelId>;
  // Add the table columns the list does not name, in schema order, except
  // the excluded ones. `columnOptions` changes some of them in place.
  remainingTable(options?: {
    exclude?: readonly RowFieldName<RowsByLevel[LevelId]>[];
    columnOptions?: TableColumnOptionsByName<RowsByLevel, AppServices, LevelId>;
  }): TGridRemainingTableColumnSpec<RowsByLevel, AppServices, LevelId>;
};

// Callback signature used when `columns` is passed as a function.
// Receives the builder and must return an ordered list of specs.
export type TGridColumnSpecBuilder<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = (
  columns: TGridColumnsBuilder<RowsByLevel, AppServices, LevelId>,
) => readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[];

// A level's columns: an ordered spec list, or a callback that builds one.
export type TGridLevelColumns<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> =
  | TGridColumnSpecBuilder<RowsByLevel, AppServices, LevelId>
  | readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[];

export function createTGridColumnsBuilder<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(_levelId: LevelId): TGridColumnsBuilder<RowsByLevel, AppServices, LevelId> {
  return {
    table<K extends RowFieldName<RowsByLevel[LevelId]>>(
      columnName: K,
      options?: TableColumnOptions<RowsByLevel, AppServices, LevelId, K>,
    ): TGridTableColumnSpec<RowsByLevel, AppServices, LevelId, K> {
      return { kind: "table", columnName, options };
    },

    client(
      id: string,
      options: ClientColumnOptions<RowsByLevel, AppServices, LevelId>,
    ): TGridClientColumnSpec<RowsByLevel, AppServices, LevelId> {
      return { kind: "client", id, options };
    },

    remainingTable(options?: {
      exclude?: readonly RowFieldName<RowsByLevel[LevelId]>[];
      columnOptions?: TableColumnOptionsByName<
        RowsByLevel,
        AppServices,
        LevelId
      >;
    }): TGridRemainingTableColumnSpec<RowsByLevel, AppServices, LevelId> {
      return {
        kind: "remainingTable",
        exclude: options?.exclude,
        columnOptions: options?.columnOptions,
      };
    },
  };
}
