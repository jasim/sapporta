import { createElement } from "react";
import type {
  ColumnSchema as TableColumnSchema,
  TableSchema,
} from "@sapporta/shared/contracts";
import type { ColId, ColumnSchema as GridColumnSchema } from "@/grid";
import { ExpandCell } from "../../grid/react/cells/ExpandCell";
import { columnPreset, type ColumnWidth } from "../../column-preset";
import { inferDisplayType, type DisplayType } from "../../models/column-types";
import type { TableForeignKeyLookupBundle } from "./table-lookup-registry";

export type TableGridThemeColumnMeta = {
  table: string;
  schema: TableColumnSchema;
  displayType: DisplayType;
};

export type TableGridThemeContext = {
  lookupBundleFor(args: {
    tableName: string;
    column: TableColumnSchema;
  }): TableForeignKeyLookupBundle | undefined;
};

export type TableGridThemeLevelOptions = {
  table: TableSchema;
  projectedColumns?: readonly string[];
  immutable: boolean;
  expandable: boolean;
  context: TableGridThemeContext;
};

export function tableColumnsToGridThemeColumns(
  options: TableGridThemeLevelOptions,
): GridColumnSchema[] {
  const projected = projectColumns(options.table, options.projectedColumns);
  const columns = projected
    .filter((c) => !c.visuallyHidden)
    .map((column) =>
      tableColumnToGridThemeColumn({
        tableName: options.table.name,
        column,
        immutable: options.immutable,
        context: options.context,
      }),
    );

  if (options.expandable && columns.length > 0) {
    const first = columns[0];
    const originalRenderer = first.renderCell;
    columns[0] = {
      ...first,
      renderCell: (props) =>
        createElement(
          ExpandCell,
          { row: props.row, path: props.path },
          originalRenderer(props),
        ),
    };
  }

  return columns;
}

export function tableColumnToGridThemeColumn(args: {
  tableName: string;
  column: TableColumnSchema;
  immutable: boolean;
  context: TableGridThemeContext;
}): GridColumnSchema {
  const { tableName, column, immutable, context } = args;
  const displayType = inferDisplayType(column);
  const editable = !immutable && displayType !== "pk" && displayType !== "date";
  const common = {
    id: column.name as ColId,
    name: column.header ?? column.name,
    editable,
    width: tableColumnPresetWidth(column),
    meta: {
      table: tableName,
      schema: column,
      displayType,
    } satisfies TableGridThemeColumnMeta,
  };

  switch (displayType) {
    case "pk":
      return columnPreset.identifier({
        ...common,
        editable: false,
      });
    case "fk": {
      const bundle = context.lookupBundleFor({ tableName, column });
      if (!bundle) {
        throw new Error(
          `tableColumnToGridThemeColumn: FK column '${tableName}.${column.name}' has no lookup bundle`,
        );
      }
      return columnPreset.foreignKey({
        ...common,
        valueLookup: bundle.valueLookup,
        searchLookup: bundle.searchLookup,
      });
    }
    case "select":
      return columnPreset.select({
        ...common,
        options: column.select?.options ?? [],
      });
    case "checkbox":
      return columnPreset.boolean(common);
    case "date":
      return columnPreset.date({
        ...common,
        editable: false,
      });
    case "number":
      return columnPreset.number(common);
    case "currency":
      return columnPreset.currency({
        ...common,
        colorRule: column.colorRule,
        zeroDisplay: column.zeroDisplay,
        strong: column.strong,
      });
    case "percentage":
      return columnPreset.percentage({
        ...common,
        colorRule: column.colorRule,
        zeroDisplay: column.zeroDisplay,
        strong: column.strong,
      });
    case "text":
      return columnPreset.text({
        ...common,
        display: column.textDisplay,
      });
  }
}

export function tableColumnPresetWidth(
  column: TableColumnSchema,
): ColumnWidth | undefined {
  if (column.width != null) {
    return { track: `calc(${column.width}ch + 1rem)` };
  }
  if (column.minWidth != null || column.maxWidth != null) {
    const min =
      column.minWidth != null ? `calc(${column.minWidth}ch + 1rem)` : "0";
    const max =
      column.maxWidth != null ? `calc(${column.maxWidth}ch + 1rem)` : "1fr";
    return { track: `minmax(${min}, ${max})` };
  }
  return undefined;
}

export function tableGridThemeColumnMeta(
  column: Pick<GridColumnSchema, "meta">,
): TableGridThemeColumnMeta | undefined {
  if (!isRecord(column.meta)) return undefined;
  if (!isRecord(column.meta.schema)) return undefined;
  if (typeof column.meta.table !== "string") return undefined;
  return column.meta as TableGridThemeColumnMeta;
}

function projectColumns(
  table: TableSchema,
  projectedColumns: readonly string[] | undefined,
): TableColumnSchema[] {
  if (!projectedColumns) return table.columns;
  const allowed = new Set(projectedColumns);
  return table.columns.filter((c) => allowed.has(c.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
