import { createElement, type ComponentType } from "react";
import type {
  CellActivation,
  CellActivationContext,
  CellEditorProps,
  CellRenderProps,
  CellEditBehavior,
  ColId,
  ColumnSchema as GridColumnSchema,
  GridPath,
  GridRuntime,
  RowKey,
} from "@sapporta/grid";
import { rowKeyOfRowId } from "@sapporta/grid";
import { withRowExpansionColumn } from "@sapporta/grid";
import { columnPreset, type ColumnWidth } from "@sapporta/grid/column-preset";
import type {
  ColumnSchema as TableColumnSchema,
  TableSchema,
} from "@sapporta/shared/contracts";
import { defaultColumnLabel } from "@sapporta/shared";
import type { TGridColumnMapper } from "./tgrid-column-mapper";
import type {
  RowFieldName,
  TableColumnName,
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "./tgrid-types";
import type {
  TGridColumnSpec,
  TGridTableColumnSpec,
  TGridClientColumnSpec,
  TableColumnOptions,
} from "./tgrid-column-spec";
import {
  tgridCellContext,
  tgridCellEditorContext,
  tgridSessionContext,
  type TGridCellContext,
  type TGridCellActivation,
  type TGridCellEditorContext,
  type TGridCellWriteHandler,
  type TGridColumnContext,
  type TGridSessionContext,
} from "./tgrid-cell-context";

// Builds concrete grid columns and write handlers from level-local specs.
// This is where abstract spec types become render-ready Grid schema columns.

export type TGridColumnBuildResult = {
  columns: GridColumnSchema[];
  saveCellValueByColumn: ReadonlyMap<
    ColId,
    TGridRuntimeCellWriteHandler<TGridRowsByLevel, unknown, string>
  >;
};

// Runtime write result shape expected by cell save handlers.
// Supports direct values, partial patches, full-row replace, or reload.
export type TGridRuntimeCellWriteResult =
  | { kind: "value"; value: unknown }
  | { kind: "patch"; patch: Record<ColId, unknown> }
  | { kind: "row"; row: Record<ColId, unknown> }
  | { kind: "reload" };

// Runtime-side write handler used by generated columns.
// It receives level path/value/row data and returns runtime result instructions.
export type TGridRuntimeCellWriteHandler<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = (context: {
  levelId: LevelId;
  path: GridPath;
  value: unknown;
  row: Readonly<RowsByLevel[LevelId]>;
  rowKey: RowKey;
  runtime: GridRuntime;
  appServices: AppServices;
}) => Promise<TGridRuntimeCellWriteResult> | TGridRuntimeCellWriteResult;

// Inputs needed to compile one level's columns.
// Carries table metadata, user specs, and session context for editor wiring.
export type TGridColumnBuildArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
> = {
  levelId: LevelId;
  table: TableSchema;
  specs?: readonly TGridColumnSpec<RowsByLevel, AppServices, LevelId>[];
  includedColumnNames?: readonly TableColumnName[];
  immutable: boolean;
  expandable: boolean;
  columnMapper: TGridColumnMapper;
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>;
};

type TGridUnknownRowsByLevel = Record<string, Record<string, unknown>>;

// Entrypoint that compiles one level's column specs into concrete grid columns.
// This is where `table`, `client`, and `remainingTable` become rendered columns.
export function buildTGridColumnsForTable<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  args: TGridColumnBuildArgs<RowsByLevel, AppServices, LevelId>,
): TGridColumnBuildResult {
  if (!args.specs) {
    // No overrides: reuse table schema order and metadata so this still behaves
    // like a plain table grid with expanders and identity columns.
    return {
      columns: args.columnMapper.columnsFor({
        table: args.table,
        includedColumnNames: args.includedColumnNames,
        immutable: args.immutable,
        expandable: args.expandable,
      }),
      saveCellValueByColumn: new Map(),
    };
  }

  const usedTableColumns = new Set<TableColumnName>();
  const saveCellValueByColumn = new Map<
    ColId,
    TGridRuntimeCellWriteHandler<TGridRowsByLevel, unknown, string>
  >();
  const columns: GridColumnSchema[] = [];

  for (const spec of args.specs) {
    // Specs are applied in declaration order; first table/cell decides which
    // column shows up first at this level.
    if (spec.kind === "remainingTable") {
      const excluded = new Set(spec.exclude ?? []);
      for (const column of tableColumnsForProjection(
        args.table,
        args.includedColumnNames,
      )) {
        if (column.visuallyHidden) continue;
        if (usedTableColumns.has(column.name)) continue;
        if (excluded.has(column.name as RowFieldName<RowsByLevel[LevelId]>))
          continue;
        columns.push(
          args.columnMapper.columnFor({
            tableName: args.table.name,
            column,
            immutable: args.immutable,
          }),
        );
        usedTableColumns.add(column.name);
      }
      continue;
    }

    if (spec.kind === "client") {
      columns.push(clientColumnFor(args.levelId, spec, args.sessionContext));
      continue;
    }

    const tableColumn = tableColumnByName(
      args.table,
      spec.columnName as TableColumnName,
    );
    const gridColumn = args.columnMapper.columnFor({
      tableName: args.table.name,
      column: applyTableColumnOptions(tableColumn, spec.options),
      immutable: args.immutable,
    });
    columns.push(
      customizeTableColumn(
        args.levelId,
        gridColumn,
        tableColumn,
        spec,
        args.sessionContext,
      ),
    );
    usedTableColumns.add(tableColumn.name);

    if (spec.options?.saveCellValue) {
      saveCellValueByColumn.set(
        gridColumn.id,
        toRuntimeCellWriteHandler(args.levelId, spec.options.saveCellValue, {
          id: gridColumn.id,
          tableColumnName: spec.columnName,
          schema: tableColumn,
          gridColumn,
        }) as TGridRuntimeCellWriteHandler<TGridRowsByLevel, unknown, string>,
      );
    }
  }

  if (args.expandable && columns.length > 0) {
    columns[0] = withRowExpansionColumn(columns[0]);
  }

  return { columns, saveCellValueByColumn };
}

function tableColumnsForProjection(
  table: TableSchema,
  includedColumnNames: readonly TableColumnName[] | undefined,
): TableColumnSchema[] {
  if (!includedColumnNames) return table.columns;
  const included = new Set(includedColumnNames);
  return table.columns.filter((column) => included.has(column.name));
}

function tableColumnByName(
  table: TableSchema,
  columnName: TableColumnName,
): TableColumnSchema {
  const column = table.columns.find((c) => c.name === columnName);
  if (!column) {
    throw new Error(
      `TGridColumnsBuilder.table: table '${table.name}' has no column '${columnName}'`,
    );
  }
  return column;
}

function applyTableColumnOptions<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  column: TableColumnSchema,
  options: TableColumnOptions<RowsByLevel, AppServices, LevelId, K> | undefined,
): TableColumnSchema {
  if (!options) return column;
  return {
    ...column,
    label: options.label ?? column.label,
    width: options.width ?? column.width,
    minWidth: options.minWidth ?? column.minWidth,
    maxWidth: options.maxWidth ?? column.maxWidth,
  };
}

function customizeTableColumn<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  levelId: LevelId,
  gridColumn: GridColumnSchema,
  tableColumn: TableColumnSchema,
  spec: TGridTableColumnSpec<RowsByLevel, AppServices, LevelId, K>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
): GridColumnSchema {
  const options = spec.options;
  if (!options) return gridColumn;

  const columnContext: TGridColumnContext<RowsByLevel[LevelId]> = {
    id: gridColumn.id,
    tableColumnName: spec.columnName,
    schema: tableColumn,
    gridColumn,
  };
  const next: GridColumnSchema = { ...gridColumn };
  if (options.label) next.name = options.label;
  if (options.edit !== undefined) {
    next.edit = typedEdit(
      levelId,
      next.edit,
      options.edit,
      columnContext,
      sessionContext,
    );
  }
  if (options.activation) {
    next.activation = typedActivation(
      levelId,
      options.activation,
      columnContext,
      sessionContext,
    );
  }
  if (options.renderCell) {
    next.renderCell = typedRenderCell(
      levelId,
      options.renderCell,
      columnContext,
      sessionContext,
    );
  }
  return next;
}

function clientColumnFor<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  spec: TGridClientColumnSpec<RowsByLevel, AppServices, LevelId>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
): GridColumnSchema {
  const gridColumn = columnPreset.text({
    id: spec.id as ColId,
    name: spec.options.label ?? defaultColumnLabel(spec.id),
    width: normalizeClientColumnWidth(spec.options.width),
    edit: spec.options.edit === "default" ? "default" : "none",
    renderCell: () => null,
    meta: {
      kind: "client",
      id: spec.id,
    },
  });
  const columnContext: TGridColumnContext<RowsByLevel[LevelId]> = {
    id: gridColumn.id,
    gridColumn,
  };
  const edit = typedEdit(
    levelId,
    gridColumn.edit,
    spec.options.edit,
    columnContext,
    sessionContext,
  );
  return {
    ...gridColumn,
    edit,
    activation: spec.options.activation
      ? typedActivation(
          levelId,
          spec.options.activation,
          columnContext,
          sessionContext,
        )
      : gridColumn.activation,
    renderCell: spec.options.renderCell
      ? typedRenderCell(
          levelId,
          spec.options.renderCell,
          columnContext,
          sessionContext,
        )
      : gridColumn.renderCell,
  };
}

function typedRenderCell<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  RenderCell: ComponentType<
    TGridCellContext<RowsByLevel, AppServices, LevelId>
  >,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
) {
  return (props: CellRenderProps) => {
    const context = cellContextFor(levelId, props, column, sessionContext());
    return createElement(
      tgridSessionContext.Provider,
      {
        value: sessionContext() as unknown as TGridSessionContext<
          TGridUnknownRowsByLevel,
          unknown
        >,
      },
      createElement(
        tgridCellContext.Provider,
        {
          value: context as unknown as TGridCellContext<
            TGridUnknownRowsByLevel,
            unknown,
            string
          >,
        },
        createElement(RenderCell, context),
      ),
    );
  };
}

function typedActivation<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  activation: TGridCellActivation<RowsByLevel, AppServices, LevelId>,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
): CellActivation {
  const describe = activation.describe;
  return {
    startsOn: activation.startsOn,
    describe:
      typeof describe === "string"
        ? describe
        : (ctx) =>
            describe(
              typedActivationContext(levelId, ctx, column, sessionContext),
            ),
    run: (ctx) =>
      activation.run(
        typedActivationContext(levelId, ctx, column, sessionContext),
      ),
  };
}

function typedActivationContext<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  ctx: CellActivationContext,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
) {
  return {
    ...cellContextFor(
      levelId,
      { ...ctx, activation: null },
      column,
      sessionContext(),
    ),
    trigger: ctx.trigger,
    actions: ctx.actions,
  };
}

function typedEdit<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  levelId: LevelId,
  current: CellEditBehavior | undefined,
  edit:
    | TableColumnOptions<RowsByLevel, AppServices, LevelId, K>["edit"]
    | TGridClientColumnSpec<
        RowsByLevel,
        AppServices,
        LevelId
      >["options"]["edit"],
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
): CellEditBehavior | undefined {
  if (edit === undefined) return current;
  if (edit === "none") return undefined;
  if (edit === "default") return current;
  const editor =
    edit.editor === undefined || edit.editor === "default"
      ? current?.editor
      : typedEditor(
          levelId,
          edit.editor as ComponentType<
            TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K>
          >,
          column,
          sessionContext,
        );
  if (!editor) return undefined;
  return {
    editor,
    startsOn: edit.startsOn ?? current?.startsOn ?? [],
  };
}

function typedEditor<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  levelId: LevelId,
  Editor: ComponentType<
    TGridCellEditorContext<RowsByLevel, AppServices, LevelId, K>
  >,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  sessionContext: () => TGridSessionContext<RowsByLevel, AppServices>,
) {
  return function TGridTypedCellEditor(props: CellEditorProps) {
    const session = sessionContext();
    const baseContext = cellContextFor(levelId, props, column, session);
    const editorContext: TGridCellEditorContext<
      RowsByLevel,
      AppServices,
      LevelId,
      K
    > = {
      ...baseContext,
      editStart: props.editStart,
      value: props.value as RowsByLevel[LevelId][K],
      commit: (value, target) => props.commit(value, target),
      cancel: props.cancel,
    };
    return createElement(
      tgridSessionContext.Provider,
      {
        value: session as unknown as TGridSessionContext<
          TGridUnknownRowsByLevel,
          unknown
        >,
      },
      createElement(
        tgridCellContext.Provider,
        {
          value: editorContext as unknown as TGridCellContext<
            TGridUnknownRowsByLevel,
            unknown,
            string
          >,
        },
        createElement(
          tgridCellEditorContext.Provider,
          {
            value: editorContext as unknown as TGridCellEditorContext<
              TGridUnknownRowsByLevel,
              unknown,
              string,
              string
            >,
          },
          createElement(Editor, editorContext),
        ),
      ),
    );
  };
}

function cellContextFor<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
>(
  levelId: LevelId,
  props:
    | Pick<CellRenderProps, "path" | "value" | "row" | "activation">
    | CellEditorProps,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
  session: TGridSessionContext<RowsByLevel, AppServices>,
): TGridCellContext<RowsByLevel, AppServices, LevelId> {
  return {
    levelId,
    path: props.path,
    value: props.value,
    row: props.row.columns as RowsByLevel[LevelId],
    rowKey: rowKeyOfRowId(props.row.id),
    column,
    runtime: session.runtime,
    appServices: session.appServices,
    activation: "activation" in props ? props.activation : null,
  };
}

function toRuntimeCellWriteHandler<
  RowsByLevel extends TGridRowsByLevel,
  AppServices,
  LevelId extends TGridLevelId<RowsByLevel>,
  K extends RowFieldName<RowsByLevel[LevelId]>,
>(
  levelId: LevelId,
  handler: TGridCellWriteHandler<RowsByLevel, AppServices, LevelId, K>,
  column: TGridColumnContext<RowsByLevel[LevelId]>,
): TGridRuntimeCellWriteHandler<RowsByLevel, AppServices, LevelId> {
  return async (context) => {
    const result = await handler({
      ...context,
      levelId,
      value: context.value as RowsByLevel[LevelId][K],
      row: context.row as Readonly<RowsByLevel[LevelId]>,
      column,
    });
    switch (result.kind) {
      case "value":
        return { kind: "value", value: result.value };
      case "patch":
        return { kind: "patch", patch: recordFromRow(result.patch) };
      case "row":
        return { kind: "row", row: recordFromRow(result.row) };
      case "reload":
        return { kind: "reload" };
    }
  };
}

function normalizeClientColumnWidth(
  width: number | ColumnWidth | undefined,
): ColumnWidth | undefined {
  if (typeof width === "number") return { track: `${width}px` };
  return width;
}

function recordFromRow(row: Partial<TGridTableRow>): Record<ColId, unknown> {
  return { ...row } as Record<ColId, unknown>;
}
