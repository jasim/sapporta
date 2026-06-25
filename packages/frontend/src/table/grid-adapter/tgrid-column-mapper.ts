import type {
  ColumnSchema as TableColumnSchema,
  TableSchema,
} from "@sapporta/shared/contracts";
import type { ColId, ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import { withRowExpansionColumn } from "@sapporta/grid";
import {
  columnPreset,
  columnPresetWidthForSizing,
  type ColumnWidth,
} from "@sapporta/grid/column-preset";
import { inferDisplayType, type DisplayType } from "@/table/model/column-types";
import type { TableForeignKeyLookupBundle } from "@/table/lookup/table-lookup-registry";
import type { TableColumnName } from "./tgrid-types";
import type { TGridLookupResolver } from "./tgrid-lookup-resolver";

export type TGridTableColumnMeta = {
  table: string;
  schema: TableColumnSchema;
  displayType: DisplayType;
};

export type TGridColumnMapOptions = {
  table: TableSchema;
  includedColumnNames?: readonly TableColumnName[];
  immutable: boolean;
  expandable: boolean;
};

export type TGridColumnMapper = {
  columnsFor(options: TGridColumnMapOptions): GridColumnSchema[];
  columnFor(args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
  }): GridColumnSchema;
  metaOf(
    column: Pick<GridColumnSchema, "meta">,
  ): TGridTableColumnMeta | undefined;
};

export function createTGridColumnMapper(
  lookupResolver: TGridLookupResolver,
): TGridColumnMapper {
  return {
    columnsFor(options) {
      return columnsFor(lookupResolver, options);
    },
    columnFor(args) {
      return columnFor(lookupResolver, args);
    },
    metaOf(column) {
      return tgridTableColumnMetaOf(column);
    },
  };
}

function columnsFor(
  lookupResolver: TGridLookupResolver,
  options: TGridColumnMapOptions,
): GridColumnSchema[] {
  const included = includeColumns(options.table, options.includedColumnNames);
  const columns = included
    .filter((c) => !c.visuallyHidden)
    .map((column) =>
      columnFor(lookupResolver, {
        tableName: options.table.name,
        column,
        immutable: options.immutable,
      }),
    );

  if (options.expandable && columns.length > 0) {
    columns[0] = withRowExpansionColumn(columns[0]);
  }

  return columns;
}

function columnFor(
  lookupResolver: TGridLookupResolver,
  args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
  },
): GridColumnSchema {
  const { tableName, column, immutable } = args;
  const displayType = inferDisplayType(column);
  const editable =
    !immutable &&
    displayType !== "pk" &&
    displayType !== "date" &&
    displayType !== "timestamp";
  const common = {
    id: column.name as ColId,
    name: column.label,
    edit: editable ? ("default" as const) : ("none" as const),
    width: tableColumnPresetWidth(column),
    meta: {
      table: tableName,
      schema: column,
      displayType,
    } satisfies TGridTableColumnMeta,
  };

  switch (displayType) {
    case "pk":
      return columnPreset.identifier({
        ...common,
        edit: "none",
      });
    case "fk": {
      const bundle = lookupResolver.bundleFor({ tableName, column });
      if (!bundle) {
        throw new Error(
          `TGridColumnMapper.columnFor: FK column '${tableName}.${column.name}' has no lookup bundle`,
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
    case "timestamp":
      return columnPreset.date({
        ...common,
        edit: "none",
      });
    case "number":
      return columnPreset.number(common);
    case "currency":
      return columnPreset.currency({
        ...common,
        colorRule: column.colorRule,
        zeroDisplay: column.zeroDisplay ?? "dot",
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
  return columnPresetWidthForSizing(column);
}

function tgridTableColumnMetaOf(
  column: Pick<GridColumnSchema, "meta">,
): TGridTableColumnMeta | undefined {
  if (!isRecord(column.meta)) return undefined;
  if (!isRecord(column.meta.schema)) return undefined;
  if (typeof column.meta.table !== "string") return undefined;
  return column.meta as TGridTableColumnMeta;
}

function includeColumns(
  table: TableSchema,
  includedColumnNames: readonly TableColumnName[] | undefined,
): TableColumnSchema[] {
  if (!includedColumnNames) return table.columns;
  const included = new Set(includedColumnNames);
  return table.columns.filter((c) => included.has(c.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
