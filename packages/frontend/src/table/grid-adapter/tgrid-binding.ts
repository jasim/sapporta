import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type {
  ColumnSchema as TableColumnSchema,
  TableSchema,
} from "@sapporta/shared/contracts";
import {
  createTGridSessionWithRef,
  type CreateTGridSessionArgs,
  type TGridLiveInputs,
  type TGridSession,
} from "../state/tgrid-session";
import type { TGridLevelQueryState } from "../state/tgrid-level-query-state";
import type { TGridDefinition } from "./tgrid-runtime-config";
import {
  createTGridColumnsBuilder,
  type TGridColumnsBuilder,
} from "./tgrid-column-spec";
import type {
  RowFieldName,
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "./tgrid-types";

// Table metadata for callers that choose the table name at the use site.
export type TGridTableSchemaInput = Omit<TableSchema, "name">;

// Per-level schema overrides keyed by row fields. Use this to adjust labels or
// display metadata for one grid without changing the shared table definition.
export type TGridTableSchemaOverrides<RowShape extends TGridTableRow> = Partial<
  Omit<TableSchema, "name" | "columns">
> & {
  columns?: Partial<Record<RowFieldName<RowShape>, Partial<TableColumnSchema>>>;
};

// Identifies the level whose query controls should be read.
export type UseTGridQueryStateArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  level: LevelId;
};

// Options accepted when a React page creates a table session.
export type UseTGridSessionArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
> = CreateTGridSessionArgs<RowsByLevel, AppServices>;

// Read and update the query controls for one page-controlled level.
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

// Create a table session for a React page and dispose it when the page unmounts.
export function useTGridSession<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
>(
  definition: TGridDefinition<RowsByLevel, AppServices>,
  args: UseTGridSessionArgs<RowsByLevel, AppServices> = {},
): TGridSession<RowsByLevel, AppServices> | null {
  const liveInputsRef = useRef<TGridLiveInputs<RowsByLevel, AppServices>>({});
  liveInputsRef.current = {
    services: args.services,
    onQueryUrlChange: args.onQueryUrlChange,
    routeQuerySeeds: args.routeQuerySeeds,
  };

  const [session, setSession] = useState<TGridSession<
    RowsByLevel,
    AppServices
  > | null>(null);

  useEffect(() => {
    const next = createTGridSessionWithRef(definition, liveInputsRef);
    setSession(next);
    return () => {
      next.dispose();
      setSession((current) => (current === next ? null : current));
    };
  }, [definition]);

  return session;
}

export function createColumnsBuilder<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
  LevelId extends TGridLevelId<RowsByLevel> = TGridLevelId<RowsByLevel>,
>(levelId: LevelId): TGridColumnsBuilder<RowsByLevel, AppServices, LevelId> {
  return createTGridColumnsBuilder<RowsByLevel, AppServices, LevelId>(levelId);
}

export function defineTableSchema(
  name: string,
  input: TGridTableSchemaInput,
): TableSchema {
  return { ...input, name };
}

export function applySchemaOverrides<
  RowsByLevel extends TGridRowsByLevel,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  _levelId: LevelId,
  schema: TableSchema,
  overrides: TGridTableSchemaOverrides<RowsByLevel[LevelId]>,
): TableSchema {
  return {
    ...schema,
    ...withoutColumnOverrides(overrides),
    columns: schema.columns.map((column) => ({
      ...column,
      ...overrides.columns?.[
        column.name as keyof NonNullable<typeof overrides.columns> & string
      ],
    })),
  };
}

function withoutColumnOverrides<RowShape extends TGridTableRow>(
  overrides: TGridTableSchemaOverrides<RowShape>,
): Partial<Omit<TableSchema, "name" | "columns">> {
  const { columns: _columns, ...rest } = overrides;
  return rest;
}
