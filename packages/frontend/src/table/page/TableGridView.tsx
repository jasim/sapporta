import { useEffect, useMemo, useRef, type ComponentType } from "react";
import { useStore } from "zustand";
import type { TableSchema } from "@sapporta/shared/contracts";
import { useTGridSession } from "../grid-adapter/tgrid-binding";
import type { TGridDefinition } from "../grid-adapter/tgrid-runtime-config";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../grid-adapter/tgrid-types";
import type {
  TGridLoadedRowsBoundaryHandler,
  TGridSession,
} from "../state/tgrid-session";
import { TGrid, type ViewRelatedRowsOption } from "./TGrid";
import { TableGridHeader } from "./TableGridHeader";
import {
  TableGridPager,
  type TableGridPagerButtonRefs,
} from "./TableGridPager";
import {
  createTableGridPagerBoundaryController,
  type TableGridPagerBoundaryController,
} from "./table-grid-pager-boundary";
import { TableGridSurface } from "./TableGridSurface";
import {
  useTableGridUrlState,
  type TableGridRoute,
} from "./table-grid-url-state";
import { useTGridLifecycle } from "./tgrid-lifecycle";
import {
  tableLoadErrorMessage,
  useTGridSourceStatus,
} from "./tgrid-source-status";
import { useTableViewPreference } from "./table-view-pref";
import {
  resolveTableGridPresentation,
  useTablePageMode,
} from "./table-page-mode";

// Complete table experience for the common case: create a session, bind it to
// the caller's route, and render the standard table layout from the live
// session.
//
// The route stays outside this component so custom pages can live anywhere in
// the app while table controls update that page's URL.
export type TableGridActionsProps<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  level: TGridLevelId<RowsByLevel>;
} & (
  | {
      surface: "toolbar";
    }
  | {
      surface: "action-sheet";
      close: () => void;
    }
);

export type TableGridViewProps<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  definition: TGridDefinition<RowsByLevel, AppServices>;
  table: TableSchema;
  route: TableGridRoute;
  services?: AppServices;
  registerAs?: string;
  loadLookups?: boolean;
  onNewRecord?: () => void;
  actions?: ComponentType<TableGridActionsProps<RowsByLevel, AppServices>>;
  /** Replace the standard pager-focus behavior at loaded-row boundaries. */
  onLoadedRowsBoundary?: TGridLoadedRowsBoundaryHandler<
    RowsByLevel,
    AppServices
  >;
  viewRelatedRows?: ViewRelatedRowsOption;
  className?: string;
  gridClassName?: string;
};

export type UseTableGridArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = TableGridViewProps<RowsByLevel, AppServices>;

export type TableGridBinding<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices> | null;
  table: TableSchema;
  level: TGridLevelId<RowsByLevel>;
  routePath: string;
  onNewRecord?: () => void;
  actions?: ComponentType<TableGridActionsProps<RowsByLevel, AppServices>>;
  viewRelatedRows?: ViewRelatedRowsOption;
  className?: string;
  gridClassName?: string;
};

export function useTableGrid<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  definition,
  table,
  route,
  services,
  registerAs,
  loadLookups,
  onNewRecord,
  actions,
  onLoadedRowsBoundary,
  viewRelatedRows,
  className,
  gridClassName,
}: UseTableGridArgs<RowsByLevel, AppServices>): TableGridBinding<
  RowsByLevel,
  AppServices
> {
  const urlState = useTableGridUrlState<RowsByLevel>({
    tableName: table.name,
    columns: table.columns,
    route,
    level: definition.rootLevel,
  });

  // This hook does not own pagination chrome, so it does not choose a loaded-
  // row boundary policy. A composition can provide one explicitly.
  const session = useTGridSession(definition, {
    services,
    routeQuerySeeds: urlState.routeQuerySeeds,
    onQueryUrlChange: urlState.onQueryUrlChange,
    onLoadedRowsBoundary,
  });

  useTGridLifecycle({
    session,
    registerAs,
    loadLookups,
  });

  useEffect(() => {
    if (!session) return;
    urlState.syncSessionFromUrl(session);
  }, [session, urlState]);

  return {
    session,
    table,
    level: urlState.level,
    routePath: urlState.routePath,
    onNewRecord,
    actions,
    viewRelatedRows,
    className,
    gridClassName,
  };
}

// Mount a TGrid definition as a reusable table view.
// Use the lower-level hooks directly when a page needs custom chrome around the
// same session primitives.
export function TableGridView<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  definition,
  table,
  route,
  services,
  registerAs,
  loadLookups,
  onNewRecord,
  actions,
  onLoadedRowsBoundary,
  viewRelatedRows,
  className,
  gridClassName,
}: TableGridViewProps<RowsByLevel, AppServices>) {
  const previousPageButtonRef = useRef<HTMLButtonElement>(null);
  const nextPageButtonRef = useRef<HTMLButtonElement>(null);
  const pagerButtonRefs = useMemo<TableGridPagerButtonRefs>(
    () => ({
      previous: previousPageButtonRef,
      next: nextPageButtonRef,
    }),
    [],
  );
  const pagerBoundary = useMemo(
    () =>
      createTableGridPagerBoundaryController<RowsByLevel, AppServices>(
        definition.rootLevel,
        pagerButtonRefs,
      ),
    [definition, pagerButtonRefs],
  );
  const tableGrid = useTableGrid({
    definition,
    table,
    route,
    services,
    registerAs,
    loadLookups,
    onNewRecord,
    actions,
    onLoadedRowsBoundary:
      onLoadedRowsBoundary ?? pagerBoundary.onLoadedRowsBoundary,
    viewRelatedRows,
    className,
    gridClassName,
  });

  if (!tableGrid.session) {
    return (
      <div className="flex h-full items-center justify-center bg-sap-surface text-sap-muted">
        Loading table...
      </div>
    );
  }

  return (
    <TableGridViewWithSession
      session={tableGrid.session}
      table={tableGrid.table}
      level={tableGrid.level}
      routePath={tableGrid.routePath}
      onNewRecord={tableGrid.onNewRecord}
      actions={tableGrid.actions}
      viewRelatedRows={tableGrid.viewRelatedRows}
      className={tableGrid.className}
      gridClassName={tableGrid.gridClassName}
      pagerButtonRefs={pagerButtonRefs}
      pagerBoundary={pagerBoundary}
    />
  );
}

// The session exists only after React has created it. Keeping the "with session"
// part separate lets every hook below assume there is a live grid to read from.
function TableGridViewWithSession<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  table,
  level,
  routePath,
  onNewRecord,
  actions,
  viewRelatedRows,
  className,
  gridClassName,
  pagerButtonRefs,
  pagerBoundary,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  table: TableSchema;
  level: TGridLevelId<RowsByLevel>;
  routePath: string;
  onNewRecord?: () => void;
  actions?: ComponentType<TableGridActionsProps<RowsByLevel, AppServices>>;
  viewRelatedRows?: ViewRelatedRowsOption;
  className?: string;
  gridClassName?: string;
  pagerButtonRefs: TableGridPagerButtonRefs;
  pagerBoundary: TableGridPagerBoundaryController<RowsByLevel, AppServices>;
}) {
  const rootRowsLoadState = useTGridSourceStatus(session);
  const errorMessage =
    rootRowsLoadState.status === "initialError" ||
    rootRowsLoadState.status === "refreshError"
      ? tableLoadErrorMessage(rootRowsLoadState.error)
      : null;
  const errorBanner = useStore(
    session.queryStore,
    (state) => state.errorBanner,
  );
  const tableView = useTableViewPreference(table.name);
  const { ref, mode } = useTablePageMode();
  const presentation = resolveTableGridPresentation({
    mode,
    preference: tableView.preference,
  });

  return (
    <TableGridSurface
      ref={ref}
      mode={mode}
      tableLabel={table.label ?? table.name}
      loadState={rootRowsLoadState}
      errorMessage={errorMessage}
      errorBanner={errorBanner}
      onDismissErrorBanner={() =>
        session.queryStore.getState().setErrorBanner(null)
      }
      header={
        <TableGridHeader
          mode={mode}
          session={session}
          table={table}
          level={level}
          viewPreference={tableView.preference}
          onViewPreferenceChange={tableView.setPreference}
          onNewRecord={onNewRecord}
          actions={actions}
        />
      }
      footer={
        <TableGridPager
          mode={mode}
          session={session}
          level={level}
          routePath={routePath}
          buttonRefs={pagerButtonRefs}
          onPagerButtonActivate={pagerBoundary.onPagerButtonActivate}
          onPagerBoundaryExit={pagerBoundary.onPagerBoundaryExit}
        />
      }
      className={className}
    >
      <TGrid
        session={session}
        className={gridClassName}
        viewRelatedRows={viewRelatedRows}
        presentation={presentation}
      />
    </TableGridSurface>
  );
}
