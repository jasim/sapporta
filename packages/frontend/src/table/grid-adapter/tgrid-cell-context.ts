import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import type {
  CellActionApi,
  CellActivationState,
  CellActivationTrigger,
  CellActivationGesture,
  GridPath,
  GridRuntime,
  RowKey,
  CommitTarget,
  CellRenderActivation,
} from "@sapporta/grid";
import type {
  TableSchema,
  ColumnSchema as TableColumnSchema,
} from "@sapporta/shared/contracts";
import type { ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import type { TableLookupRegistry } from "@/table/lookup/table-lookup-registry";
import type {
  RowFieldName,
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "./tgrid-types";
import type { TGridLevelConfig } from "./tgrid-level-config";

type TGridUnknownRowsByLevel = Record<string, Record<string, unknown>>;

// Cell context types keep generic cells safe across all level ids.
// They preserve level-specific row types while sharing one runtime.
export type TGridColumnContext<Row extends TGridTableRow> = {
  id: string;
  tableColumnName?: RowFieldName<Row>;
  schema?: TableColumnSchema;
  gridColumn: GridColumnSchema;
};

export type TGridRuntimeLevel<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  levelId: LevelId;
  table: TableSchema;
  config: TGridLevelConfig<RowsByLevel, AppServices, LevelId>;
  queryStore?: unknown;
  csvExportUrl(): string;
};

// Runtime projection for one level inside a running session.
// Holds table/config references plus export + optional query-store access.
export type TGridSessionContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
> = {
  rootLevel: TGridLevelId<RowsByLevel>;
  runtime: GridRuntime;
  levels: {
    [LevelId in TGridLevelId<RowsByLevel>]: TGridRuntimeLevel<
      RowsByLevel,
      AppServices,
      LevelId
    >;
  };
  appServices: AppServices;
  lookupRegistry: TableLookupRegistry;
};

// Runtime contract passed into renderers for every visible cell.
// Includes level identity, row value, path, and render helpers.
export type TGridCellContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  levelId: LevelId;
  path: GridPath;
  value: unknown;
  row: Readonly<RowsByLevel[LevelId]>;
  rowKey: RowKey;
  column: TGridColumnContext<RowsByLevel[LevelId]>;
  runtime: GridRuntime;
  appServices: AppServices;
  activation: CellRenderActivation | null;
};

export type TGridCellActivationContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = TGridCellContext<RowsByLevel, AppServices, LevelId> & {
  trigger: CellActivationTrigger;
  actions: CellActionApi;
};

export type TGridCellActivation<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  startsOn: readonly CellActivationGesture[];
  describe:
    | string
    | ((
        ctx: TGridCellActivationContext<RowsByLevel, AppServices, LevelId>,
      ) => CellActivationState);
  run: (
    ctx: TGridCellActivationContext<RowsByLevel, AppServices, LevelId>,
  ) => void | Promise<void>;
};

// Editor-only slice of cell context with commit and cancel actions.
// Keeps inline editors strongly typed to both level and field.
export type TGridCellEditorContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> = TGridCellContext<RowsByLevel, AppServices, LevelId> & {
  value: RowsByLevel[LevelId][K];
  commit(value: RowsByLevel[LevelId][K], target?: CommitTarget): void;
  cancel(): void;
};

// Contract for save handlers before persistence logic runs.
// Provides typed value, row, path, and app services to custom writers.
export type TGridCellWriteContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> = {
  levelId: LevelId;
  path: GridPath;
  value: RowsByLevel[LevelId][K];
  row: Readonly<RowsByLevel[LevelId]>;
  rowKey: RowKey;
  column: TGridColumnContext<RowsByLevel[LevelId]>;
  runtime: GridRuntime;
  appServices: AppServices;
};

// Return formats for custom save handlers.
// Runtime interprets these to patch fields, replace rows, or force reload.
export type TGridCellWriteResult<
  RowsByLevel extends TGridRowsByLevel,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> =
  | { kind: "value"; value: RowsByLevel[LevelId][K] }
  | { kind: "patch"; patch: Partial<RowsByLevel[LevelId]> }
  | { kind: "row"; row: RowsByLevel[LevelId] }
  | { kind: "reload" };

// Exported write-handler contract used by custom editors.
// Supports cell value updates, row patches, full replacements, or reloads.
export type TGridCellWriteHandler<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
> = (
  context: TGridCellWriteContext<RowsByLevel, AppServices, LevelId, K>,
) =>
  | Promise<TGridCellWriteResult<RowsByLevel, LevelId, K>>
  | TGridCellWriteResult<RowsByLevel, LevelId, K>;

export const tgridCellContext = createContext<
  TGridCellContext<TGridUnknownRowsByLevel, unknown, string> | undefined
>(undefined);

export const tgridCellEditorContext = createContext<
  | TGridCellEditorContext<TGridUnknownRowsByLevel, unknown, string, string>
  | undefined
>(undefined);

export const tgridSessionContext = createContext<
  TGridSessionContext<TGridUnknownRowsByLevel, unknown> | undefined
>(undefined);

export function useTGridCell<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(levelId: LevelId): TGridCellContext<RowsByLevel, AppServices, LevelId> {
  // Guardrail: a row renderer must receive the exact level it was declared for.
  // This prevents subtle type drift in recursive/nested level rendering.
  const context = useContext(tgridCellContext);
  if (!context) {
    throw new Error("useTGridCell must be used inside a TGrid cell renderer");
  }
  if (context.levelId !== levelId) {
    throw new Error(
      `useTGridCell: expected level '${levelId}', got '${context.levelId}'`,
    );
  }
  return context as unknown as TGridCellContext<
    RowsByLevel,
    AppServices,
    LevelId
  >;
}

export function useTGridCellEditor<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  levelId: LevelId,
  _column: K,
): TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K> {
  // Same level contract as `useTGridCell`, plus typed field-level value.
  const context = useContext(tgridCellEditorContext);
  if (!context) {
    throw new Error(
      "useTGridCellEditor must be used inside a TGrid cell editor",
    );
  }
  if (context.levelId !== levelId) {
    throw new Error(
      `useTGridCellEditor: expected level '${levelId}', got '${context.levelId}'`,
    );
  }
  return context as unknown as TGridCellEditorContext<
    RowsByLevel,
    AppServices,
    LevelId,
    K
  >;
}

export function useCurrentTGridSession<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(): TGridSessionContext<RowsByLevel, AppServices> {
  const context = useContext(tgridSessionContext);
  if (!context) {
    throw new Error(
      "useCurrentTGridSession must be used inside a TGrid session provider",
    );
  }
  return context as unknown as TGridSessionContext<RowsByLevel, AppServices>;
}

export function withTGridSessionContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(
  session: TGridSessionContext<RowsByLevel, AppServices>,
  children: ReactNode,
): ReactNode {
  return createElement(
    tgridSessionContext.Provider,
    {
      value: session as unknown as TGridSessionContext<
        TGridUnknownRowsByLevel,
        unknown
      >,
    },
    children,
  );
}
