import type { SortDescriptor } from "@sapporta/grid";
import type { ChildSchema, TableSchema } from "@sapporta/shared/contracts";
import type { FilterCondition } from "@sapporta/shared/filter";
import type {
  fetchTableRows,
  createTableRow,
  updateTableRow,
  deleteTableRow,
} from "@/table/api/rows";
import type {
  RowFieldName,
  TableColumnName,
  TGridLevelId,
  TGridRowsByLevel,
} from "./tgrid-types";
import type {
  TGridColumnSpec,
  TGridColumnSpecBuilder,
} from "./tgrid-column-spec";

// Query behavior for one table level.
// Use `host` when the page shows controls for this level. Use `source` when the
// level is loaded from a parent row expansion and should only use defaults.
export type TGridLevelQueryConfig = {
  owner?: "host" | "source";
  pageSize?: number | (() => number);
  initialPage?: number;
  initialSort?: readonly SortDescriptor[];
  initialFilters?: readonly FilterCondition[];
  initialSearch?: string | null;
  // Always applied to row fetches and CSV exports, but not shown as editable
  // editable filters. Use this for constraints the page promises to keep.
  fixedFilters?: readonly FilterCondition[];
  urlSync?: boolean;
};

// Read-only placement information for a level.
// Cell renderers and editors can use this to understand which table they are in
// and how that table relates to its parent.
export type TGridLevelInfo = {
  levelId: string;
  tableName: string;
  parent?: {
    parentLevelId: string;
    foreignKey: TableColumnName;
  };
  childSchemas: ChildSchema[];
};

// Row transport for one level.
// Override this when a table-like view should read or save rows through a
// custom API instead of Sapporta's default table endpoints.
export type TableRowsClient = {
  fetch: typeof fetchTableRows;
  create: typeof createTableRow;
  update: typeof updateTableRow;
  remove: typeof deleteTableRow;
};

// Declaration for one table level in a TGrid definition.
// `table`, `parent`, and `childLevels` describe the rows a user can expand
// through. `includedColumnNames`, `columns`, `query`, and `rowsClient` describe
// how this level behaves.
export type TGridLevelConfig<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
  LevelId extends TGridLevelId<RowsByLevel> = TGridLevelId<RowsByLevel>,
> = {
  table: TableSchema;
  // Default table projection for generated columns at this level. Explicit
  // `columns.table(...)` entries may still include table fields outside it.
  includedColumnNames?: readonly TableColumnName[];
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

// Complete table graph keyed by level id.
// Each key must have a matching level declaration so the grid can validate
// parent/child links before rendering.
export type TGridLevelsConfigMap<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  [LevelId in TGridLevelId<RowsByLevel>]: TGridLevelConfig<
    RowsByLevel,
    AppServices,
    LevelId
  >;
};
