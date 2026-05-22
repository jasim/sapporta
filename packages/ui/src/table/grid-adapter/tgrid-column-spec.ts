import type { EditTrigger } from "@/grid";
import type { ComponentType } from "react";
import type { ColumnWidth } from "@/column-preset";
import type { RowFieldName, TGridLevelId, TGridRowsByLevel } from "./tgrid-types";
import type {
  TGridCellContext,
  TGridCellEditorContext,
  TGridCellWriteHandler,
} from "./tgrid-cell-context";

// Level-scoped builder input types used to describe visible columns.
// Every returned spec is attached to the same level id and typed row shape.
// These options are for real table fields and keep row-level typing intact.

export type TableColumnOptions<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> = {
  header?: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  editable?: boolean;
  editTriggers?: readonly EditTrigger[];
  renderCell?: ComponentType<TGridCellContext<RowsByLevel, AppServices, LevelId>>;
  editor?: ComponentType<
    TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K>
  >;
  readsRowFields?: readonly RowFieldName<RowsByLevel[LevelId]>[];
  invalidatedBy?: readonly RowFieldName<RowsByLevel[LevelId]>[];
  saveCellValue?: TGridCellWriteHandler<RowsByLevel, AppServices, LevelId, K>;
};

// Optional overrides for computed columns that are not part of table API.
// Useful for actions/labels and editor UI not mapped to a physical DB field.
export type ClientColumnOptions<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  header?: string;
  width?: number | ColumnWidth;
  editable?: boolean;
  editTriggers?: readonly EditTrigger[];
  renderCell?: ComponentType<TGridCellContext<RowsByLevel, AppServices, LevelId>>;
  editor?: ComponentType<
    TGridCellEditorContext<
      RowsByLevel,
      AppServices,
      LevelId,
      RowFieldName<RowsByLevel[LevelId]>
    >
  >;
  readsRowFields?: readonly RowFieldName<RowsByLevel[LevelId]>[];
  invalidatedBy?: readonly RowFieldName<RowsByLevel[LevelId]>[];
};

// Spec that binds a real table field to a level's column list.
// Keeps editor/rendering tightly typed to one field and one level id.
export type TGridTableColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]> = RowFieldName<RowsByLevel[LevelId]>,
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

// Spec that expands to every non-specified visible table column.
// Exclusions let callers hide specific columns while using shorthand.
export type TGridRemainingTableColumnSpec<
  RowsByLevel extends TGridRowsByLevel,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  kind: "remainingTable";
  exclude?: readonly RowFieldName<RowsByLevel[LevelId]>[];
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
  | TGridRemainingTableColumnSpec<RowsByLevel, LevelId>;

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
  // Add all remaining table columns except the excluded set.
  remainingTable(options?: {
    exclude?: readonly RowFieldName<RowsByLevel[LevelId]>[];
  }): TGridRemainingTableColumnSpec<RowsByLevel, LevelId>;
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
    }): TGridRemainingTableColumnSpec<RowsByLevel, LevelId> {
      return { kind: "remainingTable", exclude: options?.exclude };
    },
  };
}
