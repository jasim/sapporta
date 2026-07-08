import type { ComponentType, ReactNode } from "react";
import type {
  CellActivation,
  CellEditBehavior,
  CellEditGesture,
  CellEditorProps,
  CellRenderProps,
  ColumnSchema,
  GridColumnCopyBehavior,
} from "../grid/types/schema";
import type { ColId, Coord, GridPath, RowKey } from "../grid/types/identity";
import type { SortDescriptor } from "../grid/pipeline/types";
import type {
  LevelSnapshot,
  SourceLoadResult,
} from "../grid/data-sources/types";
import type { TreeNode } from "../grid/types/level-row";
import type { SearchLookup, ValueLookup } from "../lookup";
import type { ColumnPreset } from "./preset";
import type { ColumnSizingOptions } from "./column-sizing";

export type BuiltInColumnPresetKind =
  | "identifier"
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "boolean"
  | "select"
  | "lookupValue"
  | "foreignKey";

export type ColumnPresetKind = BuiltInColumnPresetKind | (string & {});

export type ColumnWidth =
  | "compact"
  | "content"
  | "fill"
  | "numeric"
  | "date"
  | "enum"
  | "foreignKey"
  | { min?: number; ideal?: number; max?: number }
  | { track: string };

export type NumberColorRule = "positive" | "negative" | "signed";
export type ZeroDisplay = "blank" | "dot";
export type ColumnAlign = "left" | "right" | "center";
export type TextDisplayMode = "multiLine" | "markdown";

export type SelectOption = {
  value: unknown;
  label: string;
};

export type GridLevelCommands<TFilter = unknown> = {
  setSort?: (
    sort: readonly SortDescriptor[] | undefined,
  ) => Promise<SourceLoadResult>;
  setFilter?: (filter: TFilter | undefined) => Promise<SourceLoadResult>;
  refetch?: () => Promise<SourceLoadResult>;
  createRow: (node: TreeNode, atIndex?: number) => Promise<unknown>;
  removeRow: (rowKey: RowKey) => void | Promise<void>;
  writeCell: (coord: Coord, value: unknown) => void;
  commitPhantomRow: (rowKey: RowKey, atIndex?: number) => Promise<unknown>;
};

export type HeaderLevelState<TFilter = unknown> = {
  path: GridPath;
  levelName: string;
  schema: ColumnSchema[];
  snapshot: LevelSnapshot;
  sort: readonly SortDescriptor[] | undefined;
  filter: TFilter | undefined;
  canWrite: boolean;
};

export type HeaderColumn<TMeta = unknown> = {
  column: ColumnSchema;
  columnIndex: number;
  preset: ColumnPreset | undefined;
  meta: TMeta | undefined;
};

export type ColumnHeaderProps<TMeta = unknown> = {
  level: HeaderLevelState;
  column: HeaderColumn<TMeta>;
  commands: GridLevelCommands;
};

export type ColumnHeaderMenuProps<TMeta = unknown, TFilter = unknown> = {
  level: HeaderLevelState<TFilter>;
  column: HeaderColumn<TMeta>;
  commands: GridLevelCommands<TFilter>;
  close: () => void;
};

export type PresetChromeOptions<TMeta = unknown, TFilter = unknown> = {
  columnSizing?: ColumnSizingOptions;
  renderColumnHeaderMenu?: (
    props: ColumnHeaderMenuProps<TMeta, TFilter>,
  ) => ReactNode;
  commandOverrides?: (
    level: HeaderLevelState<TFilter>,
  ) => Partial<GridLevelCommands<TFilter>>;
};

export type ColumnPresetEditOption =
  | "default"
  | "none"
  | {
      editor?: "default" | ComponentType<CellEditorProps>;
      startsOn?: readonly CellEditGesture[];
    };

export type ColumnPresetOptions<TMeta = unknown> = {
  kind?: ColumnPresetKind;
  id: ColId;
  name: string;
  align?: ColumnAlign;
  width?: ColumnWidth;
  edit?: ColumnPresetEditOption;
  sortable?: boolean;
  format?: (value: unknown) => string;
  parse?: (value: string, props: CellEditorProps) => unknown;
  compare?: (a: unknown, b: unknown) => number;
  renderCell?: (props: CellRenderProps) => ReactNode;
  renderColumnHeader?: (props: ColumnHeaderProps<TMeta>) => ReactNode;
  renderColumnHeaderMenu?: (
    props: ColumnHeaderMenuProps<TMeta, unknown>,
  ) => ReactNode;
  activation?: CellActivation;
  copy?: GridColumnCopyBehavior;
  meta?: TMeta;
};

export type ColumnPresetResolvedEdit = CellEditBehavior | undefined;

export type NumberColumnOptions<TMeta = unknown> =
  ColumnPresetOptions<TMeta> & {
    colorRule?: NumberColorRule;
    zeroDisplay?: ZeroDisplay;
    strong?: boolean;
  };

export type TextColumnOptions<TMeta = unknown> = ColumnPresetOptions<TMeta> & {
  display?: TextDisplayMode;
};

export type SelectColumnOptions<TMeta = unknown> =
  ColumnPresetOptions<TMeta> & {
    options: readonly (SelectOption | string)[];
  };

export type LookupColumnOptions<TMeta = unknown> =
  ColumnPresetOptions<TMeta> & {
    valueLookup: ValueLookup;
    searchLookup?: SearchLookup;
  };
