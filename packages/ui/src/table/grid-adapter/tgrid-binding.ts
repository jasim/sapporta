import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type {
  ColumnSchema as TableColumnSchema,
  TableSchema,
} from "@sapporta/shared/contracts";
import {
  createTGridSession,
  type CreateTGridSessionArgs,
  type TGridSession,
} from "@/table/state/tgrid-session";
import type { TGridLevelQueryState } from "@/table/state/tgrid-level-query-state";
import type { TGridLevelConfig } from "./tgrid-level-config";
import {
  createTGridColumnsBuilder,
  type TGridColumnSpecBuilder,
  type TGridColumnsBuilder,
} from "./tgrid-column-spec";
import {
  useCurrentTGridSession,
  useTGridCell,
  useTGridCellEditor,
  type TGridCellContext,
  type TGridCellEditorContext,
  type TGridSessionContext,
} from "./tgrid-cell-context";
import type {
  RowFieldName,
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "./tgrid-types";

// Public front-door API that glues typed level declarations to sessions.
// This module owns the stable ergonomic imports: define levels, columns, sessions, and hooks.
export type BindTGridTypesArgs<AppServices> = {
  appServices?: AppServices;
};

// Table schema constructor input without hardcoding `name`.
// Lets callers pass shared table metadata and inject a runtime name separately.
export type TGridTableSchemaInput = Omit<TableSchema, "name">;

// Per-level optional schema overlay keyed by row fields.
// Useful for lightweight customization of labels/metadata while keeping source schema.
export type TGridTableSchemaOverrides<RowShape extends TGridTableRow> = Partial<
  Omit<TableSchema, "name" | "columns">
> & {
  columns?: Partial<Record<RowFieldName<RowShape>, Partial<TableColumnSchema>>>;
  };

// Input shape for reading host query stores in UI-level code.
// Used by toolbar views to read and mutate a specific level's controls.
export type UseTGridQueryStateArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  level: LevelId;
};

// Session hook args alias used by `useSession`.
// Keeps the hook signature aligned with `createSession` construction options.
export type UseTGridSessionArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
> = CreateTGridSessionArgs<RowsByLevel, AppServices>;

// Structured result of `bindTGridTypes`.
// It exposes level-first APIs for sessions, hooks, and typed runtime access.
export type TGridBinding<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
> = {
  appServices: AppServices | undefined;
  level<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
    config: TGridLevelConfig<RowsByLevel, AppServices, LevelId>,
  ): TGridLevelConfig<RowsByLevel, AppServices, LevelId>;
  columns<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
    build: TGridColumnSpecBuilder<RowsByLevel, AppServices, LevelId>,
  ): TGridColumnSpecBuilder<RowsByLevel, AppServices, LevelId>;
  createColumnsBuilder<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
  ): TGridColumnsBuilder<RowsByLevel, AppServices, LevelId>;
  defineTableSchema(name: string, input: TGridTableSchemaInput): TableSchema;
  applySchemaOverrides<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
    schema: TableSchema,
    overrides: TGridTableSchemaOverrides<RowsByLevel[LevelId]>,
  ): TableSchema;
  createSession(
    args: CreateTGridSessionArgs<RowsByLevel, AppServices>,
  ): TGridSession<RowsByLevel, AppServices>;
  useQueryState<LevelId extends TGridLevelId<RowsByLevel>>(
    args: UseTGridQueryStateArgs<RowsByLevel, AppServices, LevelId>,
  ): TGridLevelQueryState<RowsByLevel[LevelId]>;
  useSession(
    args: UseTGridSessionArgs<RowsByLevel, AppServices>,
  ): TGridSession<RowsByLevel, AppServices>;
  useCell<LevelId extends TGridLevelId<RowsByLevel>>(
    levelId: LevelId,
  ): TGridCellContext<RowsByLevel, AppServices, LevelId>;
  useEditor<
    LevelId extends TGridLevelId<RowsByLevel>,
    K extends RowFieldName<RowsByLevel[LevelId]>,
  >(
    levelId: LevelId,
    column: K,
  ): TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K>;
  useCurrentSession(): TGridSessionContext<RowsByLevel, AppServices>;
};

// Entry point API for apps: declare typed levels once, then construct/use sessions.
// `bindTGridTypes()` is usually the first call in a typed grid feature.
export function bindTGridTypes<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  args: BindTGridTypesArgs<AppServices> = {},
): TGridBinding<RowsByLevel, AppServices> {
  const appServices = args.appServices;

  return {
    appServices,

    level(_levelId, config) {
      return config;
    },

    columns(_levelId, build) {
      return build;
    },

    createColumnsBuilder(levelId) {
      return createTGridColumnsBuilder<RowsByLevel, AppServices, typeof levelId>(
        levelId,
      );
    },

    defineTableSchema(name, input) {
      return { ...input, name };
    },

    applySchemaOverrides(_levelId, schema, overrides) {
      return {
        ...schema,
        ...withoutColumnOverrides(overrides),
        columns: schema.columns.map((column) => ({
          ...column,
          ...overrides.columns?.[column.name as keyof NonNullable<typeof overrides.columns> & string],
        })),
      };
    },

    createSession(sessionArgs) {
      // The session API is the single constructor for a concrete runtime.
      // `appServices` are injected here and then visible to custom cell
      // write handlers through `sessionContext`.
      return createTGridSession({
        ...sessionArgs,
        appServices: sessionArgs.appServices ?? appServices,
      });
    },

    useQueryState(queryArgs) {
      return useTGridQueryState(queryArgs);
    },

    useSession(sessionArgs) {
      // React hook wrapper around `createTGridSession`. The return object is
      // the host context that `TGrid` renderers and custom editors consume.
      return useTGridSession({
        ...sessionArgs,
        appServices: sessionArgs.appServices ?? appServices,
      });
    },

    useCell(levelId) {
      return useTGridCell<RowsByLevel, AppServices, typeof levelId>(levelId);
    },

    useEditor(levelId, column) {
      return useTGridCellEditor<RowsByLevel, AppServices, typeof levelId, typeof column>(
        levelId,
        column,
      );
    },

    useCurrentSession() {
      return useCurrentTGridSession<RowsByLevel, AppServices>();
    },
  };
}

// User-facing hook to get host query state for a specific level.
// Useful in toolbar-like UI that edits sorting, filtering, and search.
export function useTGridQueryState<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  args: UseTGridQueryStateArgs<RowsByLevel, AppServices, LevelId>,
): TGridLevelQueryState<RowsByLevel[LevelId]> {
  const store = args.session.levels[args.level].queryStore;
  if (!store) {
    throw new Error(
      `useTGridQueryState: level '${args.level}' does not have host-owned query state`,
    );
  }
  return useStore(
    store as StoreApi<TGridLevelQueryState<RowsByLevel[LevelId]>>,
    (state) => state,
  );
}

// User-facing hook to build or recreate a typed session in components.
// Returns a live `TGridSession` and manages disposal on unmount.
export function useTGridSession<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(
  args: UseTGridSessionArgs<RowsByLevel, AppServices>,
): TGridSession<RowsByLevel, AppServices> {
  const session = useMemo(
    () => createTGridSession(args),
    [args.rootLevel, args.levels, args.appServices, args.onUrlChange],
  );
  useEffect(() => () => session.dispose(), [session]);
  return session;
}

function withoutColumnOverrides<RowShape extends TGridTableRow>(
  overrides: TGridTableSchemaOverrides<RowShape>,
): Partial<Omit<TableSchema, "name" | "columns">> {
  const { columns: _columns, ...rest } = overrides;
  return rest;
}
