import { useMemo, type ComponentType, type Ref } from "react";
import type { GridInteractionConfig } from "@sapporta/grid";
import type { TableSchema } from "@sapporta/shared/contracts";
import {
  defineSchemaTGrid,
  type SchemaTableRelatedRowsOptions,
  type SchemaTableGridSource,
  type SchemaTableRootRowsOptions,
  type SchemaTableRowsByLevel,
} from "../tgrid/schema-tgrid";
import type { TGridDefinition } from "../tgrid/tgrid-runtime-config";
import type {
  TGridLoadedRowsBoundaryHandler,
  TGridSession,
} from "../tgrid/tgrid-session";
import type { TableGridRoute } from "./table-grid-url-state";
import {
  TableGridView,
  useTableGrid,
  type TableGridActionsProps,
  type TableGridBinding,
} from "./TableGridView";
import type { ViewRelatedRowsOption } from "../tgrid/TGrid";

export type SchemaTableGridViewSource = {
  table: TableSchema;
  tablesByName: Record<string, TableSchema>;
};

export type SchemaTableGridViewProps = {
  /** Pass the table to show and any loaded schemas needed for expandable rows. */
  source: SchemaTableGridViewSource;
  /** Pass the current page path and router helpers so table controls update the URL. */
  route: TableGridRoute;
  /** Use a stable name, usually the table name, for this table page. */
  registerAs?: string;
  /** Provide this when the page should show a New record action. */
  onNewRecord?: () => void;
  /** Render application-defined actions in the table toolbar and action sheet. */
  actions?: ComponentType<TableGridActionsProps<SchemaTableRowsByLevel>>;
  /** Receive the borrowed live session. TableGridView owns and disposes it. */
  sessionRef?: Ref<TGridSession<SchemaTableRowsByLevel>>;
  /** Replace the standard pager-focus behavior at loaded-row boundaries. */
  onLoadedRowsBoundary?: TGridLoadedRowsBoundaryHandler<SchemaTableRowsByLevel>;
  /** Tune row expansion, row loading, interaction, controls, and styling. */
  viewRelatedRows?: ViewRelatedRowsOption;
  rootRows?: SchemaTableRootRowsOptions;
  relatedRows?: SchemaTableRelatedRowsOptions;
  interaction?: GridInteractionConfig;
  loadLookups?: boolean;
  className?: string;
  gridClassName?: string;
};

export type UseSchemaTableGridArgs = Omit<
  SchemaTableGridViewProps,
  "sessionRef"
>;

const schemaTableGridDefaultRootRows: SchemaTableRootRowsOptions = {
  urlSync: true,
};

function definedRowOptions(
  options: SchemaTableRootRowsOptions,
): SchemaTableRootRowsOptions | undefined {
  const entries = Object.entries(options).filter(
    ([, value]) => value !== undefined,
  );

  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as SchemaTableRootRowsOptions);
}

function useStableRowOptions({
  options,
  defaults = {},
}: {
  options?: SchemaTableRootRowsOptions;
  defaults?: SchemaTableRootRowsOptions;
}): SchemaTableRootRowsOptions | undefined {
  const pageSize = options?.pageSize ?? defaults.pageSize;
  const initialPage = options?.initialPage ?? defaults.initialPage;
  const initialSort = options?.initialSort ?? defaults.initialSort;
  const initialFilters = options?.initialFilters ?? defaults.initialFilters;
  const initialSearch =
    options?.initialSearch !== undefined
      ? options.initialSearch
      : defaults.initialSearch;
  const fixedFilters = options?.fixedFilters ?? defaults.fixedFilters;
  const urlSync = options?.urlSync ?? defaults.urlSync;

  return useMemo(
    () =>
      definedRowOptions({
        pageSize,
        initialPage,
        initialSort,
        initialFilters,
        initialSearch,
        fixedFilters,
        urlSync,
      }),
    [
      fixedFilters,
      initialFilters,
      initialPage,
      initialSearch,
      initialSort,
      pageSize,
      urlSync,
    ],
  );
}

function useStableInteractionOptions(
  interaction?: GridInteractionConfig,
): GridInteractionConfig | undefined {
  const mode = interaction?.mode;
  const selectedCellsKind = interaction?.selectedCells.kind;
  const activeRowKind = interaction?.activeRow.kind;
  const cellGridTabularArrows =
    interaction?.mode === "cell-grid"
      ? interaction.activeCell.keyboard.arrows.tabular
      : undefined;
  const cellGridCardsArrows =
    interaction?.mode === "cell-grid"
      ? interaction.activeCell.keyboard.arrows.cards
      : undefined;
  const rowListArrows =
    interaction?.mode === "row-list"
      ? interaction.activeRow.keyboard.arrows
      : undefined;
  const rowListShiftArrows =
    interaction?.mode === "row-list"
      ? interaction.activeRow.keyboard.shiftArrows
      : undefined;
  const rowListExpansion =
    interaction?.mode === "row-list"
      ? interaction.activeRow.keyboard.expansion
      : undefined;
  const activeRowConfig = interaction?.activeRow;
  const rowActivationGestures =
    activeRowConfig && activeRowConfig.kind !== "none"
      ? activeRowConfig.activation?.startsOn.join(",")
      : undefined;
  const selectedRowsKind = interaction?.selectedRows.kind;
  const selectedRowsMode =
    interaction?.selectedRows.kind === "enabled"
      ? interaction.selectedRows.mode
      : undefined;
  const selectedRowsSync =
    interaction?.selectedRows.kind === "enabled"
      ? interaction.selectedRows.sync.kind
      : undefined;

  // The config object may be inline; the finite interaction fields are the
  // dependency contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => interaction,
    [
      cellGridCardsArrows,
      cellGridTabularArrows,
      activeRowKind,
      mode,
      selectedCellsKind,
      rowActivationGestures,
      rowListArrows,
      rowListExpansion,
      rowListShiftArrows,
      selectedRowsKind,
      selectedRowsMode,
      selectedRowsSync,
    ],
  );
}

export function SchemaTableGridView({
  source,
  route,
  registerAs,
  onNewRecord,
  actions,
  sessionRef,
  onLoadedRowsBoundary,
  viewRelatedRows,
  rootRows,
  relatedRows,
  interaction,
  loadLookups,
  className,
  gridClassName,
}: SchemaTableGridViewProps) {
  const definition = useSchemaTableGridDefinition({
    source,
    rootRows,
    relatedRows,
    interaction,
  });

  return (
    <TableGridView<SchemaTableRowsByLevel>
      definition={definition}
      table={source.table}
      route={route}
      registerAs={registerAs}
      loadLookups={loadLookups}
      onNewRecord={onNewRecord}
      actions={actions}
      sessionRef={sessionRef}
      onLoadedRowsBoundary={onLoadedRowsBoundary}
      viewRelatedRows={viewRelatedRows}
      className={className}
      gridClassName={gridClassName}
    />
  );
}

export function useSchemaTableGrid({
  source,
  route,
  registerAs,
  onNewRecord,
  actions,
  onLoadedRowsBoundary,
  viewRelatedRows,
  rootRows,
  relatedRows,
  interaction,
  loadLookups,
  className,
  gridClassName,
}: UseSchemaTableGridArgs): TableGridBinding<SchemaTableRowsByLevel> {
  const definition = useSchemaTableGridDefinition({
    source,
    rootRows,
    relatedRows,
    interaction,
  });

  return useTableGrid<SchemaTableRowsByLevel>({
    definition,
    table: source.table,
    route,
    registerAs,
    loadLookups,
    onNewRecord,
    actions,
    onLoadedRowsBoundary,
    viewRelatedRows,
    className,
    gridClassName,
  });
}

function useSchemaTableGridDefinition({
  source,
  rootRows,
  relatedRows,
  interaction,
}: {
  source: SchemaTableGridViewSource;
  rootRows?: SchemaTableRootRowsOptions;
  relatedRows?: SchemaTableRelatedRowsOptions;
  interaction?: GridInteractionConfig;
}): TGridDefinition<SchemaTableRowsByLevel> {
  const gridSource = useMemo<SchemaTableGridSource>(
    () => ({
      rootTableName: source.table.name,
      tablesByName: source.tablesByName,
    }),
    [source.table.name, source.tablesByName],
  );
  const rootRowOptions = useStableRowOptions({
    options: rootRows,
    defaults: schemaTableGridDefaultRootRows,
  });
  const relatedRowOptions = useStableRowOptions({ options: relatedRows });
  const interactionOptions = useStableInteractionOptions(interaction);
  const definition = useMemo(
    () =>
      defineSchemaTGrid({
        source: gridSource,
        rootRows: rootRowOptions,
        relatedRows: relatedRowOptions,
        interaction: interactionOptions,
      }),
    [gridSource, interactionOptions, relatedRowOptions, rootRowOptions],
  );

  return definition;
}
