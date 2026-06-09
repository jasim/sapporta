import { useEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  Pagination,
  type PaginationProps,
} from "@/table/grid-adapter/Pagination";
import { useTGridSession } from "@/table/grid-adapter/tgrid-binding";
import type { TGridDefinition } from "@/table/grid-adapter/tgrid-runtime-config";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridSession } from "@/table/state/tgrid-session";
import { TGrid, type ViewRelatedRowsOption } from "./TGrid";
import { TableGridSurface } from "./TableGridSurface";
import { TableToolbar, type TableToolbarProps } from "./TableToolbar";
import {
  useTableGridUrlState,
  type TableGridRoute,
  type TableGridUrlStateBinding,
} from "./table-grid-url-state";
import { useTablePaginationProps } from "./table-pagination-binding";
import { useTableToolbarProps } from "./table-toolbar-binding";
import { useTGridLifecycle } from "./tgrid-lifecycle";
import {
  tableLoadErrorMessage,
  useTGridSourceStatus,
} from "./tgrid-source-status";

// A custom toolbar receives the same ready-to-render props as the default
// toolbar, plus the live session for advanced actions such as row reloads.
export type TableGridToolbarRenderArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  props: TableToolbarProps;
};

// A custom pagination control receives the page model Sapporta uses for the
// built-in table page, including route-aware links for each page.
export type TableGridPaginationRenderArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices>;
  props: PaginationProps;
};

// Complete table experience for the common case: create a session, bind it to
// the caller's route, show the standard toolbar/grid/pagination layout, and let
// the caller replace any visible control with props they can inspect.
//
// The route stays outside this component so custom pages can live anywhere in
// the app while table controls update that page's URL.
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
  viewRelatedRows?: ViewRelatedRowsOption;
  toolbar?:
    | false
    | ((
        args: TableGridToolbarRenderArgs<RowsByLevel, AppServices>,
      ) => ReactNode);
  pagination?:
    | false
    | ((
        args: TableGridPaginationRenderArgs<RowsByLevel, AppServices>,
      ) => ReactNode);
  className?: string;
  gridClassName?: string;
};

// Mount a TGrid definition as a reusable table view.
// Use this when your page wants Sapporta's standard table affordances with a
// small amount of customization. Use the lower-level hooks directly when you
// want to assemble a different surface.
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
  viewRelatedRows,
  toolbar,
  pagination,
  className,
  gridClassName,
}: TableGridViewProps<RowsByLevel, AppServices>) {
  const urlState = useTableGridUrlState<RowsByLevel>({
    tableName: table.name,
    columns: table.columns,
    route,
    level: definition.rootLevel,
  });

  const session = useTGridSession(definition, {
    services,
    routeQuerySeeds: urlState.routeQuerySeeds,
    onQueryUrlChange: urlState.onQueryUrlChange,
  });

  useTGridLifecycle({
    session,
    registerAs,
    loadLookups,
  });

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center bg-sap-surface text-sap-muted">
        Loading table...
      </div>
    );
  }

  return (
    <TableGridViewWithSession
      session={session}
      table={table}
      level={urlState.level}
      routePath={urlState.routePath}
      urlState={urlState}
      onNewRecord={onNewRecord}
      viewRelatedRows={viewRelatedRows}
      toolbar={toolbar}
      pagination={pagination}
      className={className}
      gridClassName={gridClassName}
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
  urlState,
  onNewRecord,
  viewRelatedRows,
  toolbar,
  pagination,
  className,
  gridClassName,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  table: TableSchema;
  level: TGridLevelId<RowsByLevel>;
  routePath: string;
  urlState: TableGridUrlStateBinding<RowsByLevel>;
  onNewRecord?: () => void;
  viewRelatedRows?: ViewRelatedRowsOption;
  toolbar?:
    | false
    | ((
        args: TableGridToolbarRenderArgs<RowsByLevel, AppServices>,
      ) => ReactNode);
  pagination?:
    | false
    | ((
        args: TableGridPaginationRenderArgs<RowsByLevel, AppServices>,
      ) => ReactNode);
  className?: string;
  gridClassName?: string;
}) {
  useEffect(() => {
    urlState.syncSessionFromUrl(session);
  }, [session, urlState]);

  const rootRowsLoadState = useTGridSourceStatus(session);
  const errorMessage =
    rootRowsLoadState.status === "error"
      ? tableLoadErrorMessage(rootRowsLoadState.error)
      : null;
  const toolbarProps = useTableToolbarProps({
    session,
    table,
    totalCount: rootRowsLoadState.totalCount,
    level,
    onNewRecord,
  });
  const paginationProps = useTablePaginationProps({
    session,
    totalCount: rootRowsLoadState.totalCount,
    level,
    routePath,
  });
  const errorBanner = useStore(
    session.queryStore,
    (state) => state.errorBanner,
  );

  return (
    <TableGridSurface
      tableLabel={table.label ?? table.name}
      loadState={rootRowsLoadState}
      errorMessage={errorMessage}
      errorBanner={errorBanner}
      onDismissErrorBanner={() =>
        session.queryStore.getState().setErrorBanner(null)
      }
      grid={
        <TGrid
          session={session}
          className={gridClassName}
          viewRelatedRows={viewRelatedRows}
        />
      }
      toolbar={
        toolbar === false ? null : toolbar ? (
          toolbar({ session, props: toolbarProps })
        ) : (
          <TableToolbar {...toolbarProps} />
        )
      }
      pagination={
        pagination === false ? null : pagination ? (
          pagination({ session, props: paginationProps })
        ) : (
          <Pagination {...paginationProps} />
        )
      }
      className={className}
    />
  );
}
