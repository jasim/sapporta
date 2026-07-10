import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import type { ColId, ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import {
  columnPreset,
  columnPresetWidthForSizing,
  type ColumnWidth,
} from "@sapporta/grid/column-preset";
import { inferDisplayType, type DisplayType } from "../model/column-types";
import type { LookupStore } from "../../lookup";

export type TGridTableColumnMeta = {
  table: string;
  schema: TableColumnSchema;
  displayType: DisplayType;
};

export type TGridColumnMapper = {
  columnFor(args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
  }): GridColumnSchema;
  metaOf(
    column: Pick<GridColumnSchema, "meta">,
  ): TGridTableColumnMeta | undefined;
};

export function createTGridColumnMapper(args: {
  lookups: LookupStore;
}): TGridColumnMapper {
  const { lookups } = args;
  return {
    columnFor(columnArgs) {
      return columnFor(lookups, columnArgs);
    },
    metaOf(column) {
      return tgridTableColumnMetaOf(column);
    },
  };
}

function columnFor(
  lookups: LookupStore,
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
      const lookup = lookups.requireForeignKey({
        tableName,
        column,
      });
      return columnPreset.foreignKey({
        ...common,
        valueLookup: lookup.valueLookup,
        searchLookup: lookup.searchLookup,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
