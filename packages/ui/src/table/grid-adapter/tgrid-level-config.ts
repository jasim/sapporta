import type { SortDescriptor } from "@/grid";
import type { ChildSchema, TableSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
import type { fetchTableRows, createTableRow, updateTableRow, deleteTableRow } from "@/table/api/rows";
import type { RowFieldName, TableColumnName, TGridLevelId, TGridRowsByLevel } from "./tgrid-types";
import type { TGridColumnSpec, TGridColumnSpecBuilder } from "./tgrid-column-spec";

// TGrid sessions use an explicit, typed level graph as their only source of truth.
// Root and child levels share one declaration shape, with root differing only by policy.
export type TGridHostQueryState = {
  sort: SortDescriptor[];
  filters: FilterCondition[];
  search: string | null;
  page: number;
  pageSize: number;
};

// Query state held in host-owned controls and optionally persisted to URL.
// This is the exact model used by toolbar controls for a visible, user-driven level.
export type TGridLevelQueryConfig = {
  // owner "host" means level query is controlled from UI state.
  // owner "source" means query is driven by expansion path and defaults only.
  owner?: "host" | "source";
  pageSize?: number | (() => number);
  initialPage?: number;
  initialSort?: readonly SortDescriptor[];
  initialFilters?: readonly FilterCondition[];
  initialSearch?: string | null;
  urlSync?: boolean;
};

// Compact metadata describing a level's graph placement.
// Used by runtime services and editor context without changing rendering behavior.
export type TGridLevelInfo = {
  levelId: string;
  tableName: string;
  parent?: {
    parentLevelId: string;
    foreignKey: TableColumnName;
  };
  childSchemas: ChildSchema[];
};

// CRUD client contract required by one level's row endpoints.
// Replace these to route reads/writes to custom transports.
export type TableRowsClient = {
  fetch: typeof fetchTableRows;
  create: typeof createTableRow;
  update: typeof updateTableRow;
  remove: typeof deleteTableRow;
};

// Core typed declaration for one level in the explicit TGrid graph.
// table + parent + childLevels define traversal, while columns/query define behavior.
export type TGridLevelConfig<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
  LevelId extends TGridLevelId<RowsByLevel> = TGridLevelId<RowsByLevel>,
> = {
  table: TableSchema;
  columns?:
    | TGridColumnSpecBuilder<RowsByLevel, AppServices, LevelId>
    | readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[];
  childLevels: readonly TGridLevelId<RowsByLevel>[];
  parent?: {
    level: TGridLevelId<RowsByLevel>;
    foreignKey: RowFieldName<RowsByLevel[LevelId]>;
    defaultSort?: string | readonly SortDescriptor[];
  };
  query?: TGridLevelQueryConfig;
  rowsClient?: TableRowsClient;
};

// Canonical input map for session creation.
// Every key is an explicit level id, and every value is a full level contract.
export type TGridLevelsConfigMap<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  [LevelId in TGridLevelId<RowsByLevel>]: TGridLevelConfig<RowsByLevel, AppServices, LevelId>;
};
