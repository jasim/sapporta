/**
 * Adapts server-emitted table metadata to generic TGrid column presets.
 *
 * The grid package supplies editors and generic commit codecs. This adapter has
 * the `ColumnSchema` required to add table patch semantics, lookups, display
 * kinds, editability, and sizing. It is therefore the natural place to compose
 * `parseTablePatchValueDraft()` into a grid column without moving table or API
 * knowledge into the generic grid package.
 */

import { createElement } from "react";
import type { ColumnSchema as TableColumnSchema } from "@sapporta/shared/contracts";
import type {
  CellRenderProps,
  ColId,
  ColumnSchema as GridColumnSchema,
} from "@sapporta/grid";
import {
  columnPreset,
  columnPresetWidthForSizing,
  type ColumnWidth,
} from "@sapporta/grid/column-preset";
import { inferDisplayType, type DisplayType } from "../model/column-types";
import { parseTablePatchValueDraft } from "../model/table-value-draft";
import { isGridEditableColumn } from "../form/field-policy";
import { withTGridCellLinks } from "./tgrid-cell-links";
import type { LookupStore, RowDataStore } from "../../lookup";
import {
  ColumnSlotCell,
  RowLabel,
  referenceEntryRenderer,
} from "../../lookup/row-display";
import type { ColumnSlot } from "../../lookup/row-display-types";

/** Where a column is drawn, for its display slots. */
export type TGridColumnDisplay = {
  /** The level shows its rows as a tree, and this column shows the place of
   *  each row in it. */
  hierarchyShown?: boolean;
};

export type TGridTableColumnMeta = {
  table: string;
  schema: TableColumnSchema;
  displayType: DisplayType;
  /** The `title` column renders as the card's heading instead of a labeled
   *  field. Assigned after column build from the table's `rowLabelColumns`. */
  cardRole?: "title";
  /** Whether narrow cards may skip this field when its value is empty. True
   *  for default preset cells, whose empty value renders nothing; cleared by
   *  the column builder when a custom renderer or the row-expansion
   *  affordance still needs the field visible. */
  cardHideWhenEmpty?: boolean;
};

export type TGridColumnMapper = {
  columnFor(args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
    display?: TGridColumnDisplay;
  }): GridColumnSchema;
  /**
   * Draws the level's own label column (the first visible row-label column,
   * which is also the card title) with the table's `label` slot. Returns the
   * column unchanged when the table has no label slot.
   */
  labelColumnFor(args: {
    tableName: string;
    rowKeyColumn: string;
    labelColumns: readonly string[];
    gridColumn: GridColumnSchema;
    display?: TGridColumnDisplay;
  }): GridColumnSchema;
  /**
   * Draws a table column with the column's slot, over what the column draws
   * without it. Returns the column unchanged when the column has no slot.
   */
  columnSlotColumnFor(args: {
    tableName: string;
    column: TableColumnSchema;
    rowKeyColumn: string;
    gridColumn: GridColumnSchema;
    display?: TGridColumnDisplay;
  }): GridColumnSchema;
  metaOf(
    column: Pick<GridColumnSchema, "meta">,
  ): TGridTableColumnMeta | undefined;
};

export function createTGridColumnMapper(args: {
  lookups: LookupStore;
  /** The row store whose display slots draw labels, references and cells.
   *  A table session passes its `lookups`; without it, cells draw Sapporta's
   *  default. */
  rowData?: RowDataStore;
}): TGridColumnMapper {
  const { lookups, rowData } = args;
  return {
    columnFor(columnArgs) {
      return columnFor(lookups, rowData, columnArgs);
    },
    labelColumnFor(labelArgs) {
      // Without a label slot, the own label cell is the label alone, which
      // the preset cell draws already.
      return rowData?.rowDisplays[labelArgs.tableName]?.label
        ? labelColumnFor(rowData, labelArgs)
        : labelArgs.gridColumn;
    },
    columnSlotColumnFor(slotArgs) {
      const slot =
        rowData?.rowDisplays[slotArgs.tableName]?.columns?.[
          slotArgs.column.name
        ];
      return rowData && slot
        ? columnSlotColumnFor(rowData, slot, slotArgs)
        : slotArgs.gridColumn;
    },
    metaOf(column) {
      return tgridTableColumnMetaOf(column);
    },
  };
}

function columnFor(
  lookups: LookupStore,
  rowData: RowDataStore | undefined,
  args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
    display?: TGridColumnDisplay;
  },
): GridColumnSchema {
  // Schema-declared cell links (FK drill-up and author-declared links)
  // decorate the preset column with a primary-link adornment + activation.
  return withTGridCellLinks(
    presetColumnFor(lookups, rowData, args),
    args.column,
  );
}

// The row's own label cell: the preset cell is the label as Sapporta draws
// it, and the table's label slot may draw over it.
function labelColumnFor(
  rowData: RowDataStore,
  args: {
    tableName: string;
    rowKeyColumn: string;
    labelColumns: readonly string[];
    gridColumn: GridColumnSchema;
    display?: TGridColumnDisplay;
  },
): GridColumnSchema {
  const base = args.gridColumn.renderCell;
  return {
    ...args.gridColumn,
    renderCell: (props: CellRenderProps) => {
      const defaultContent = base(props);
      if (props.row.kind !== "data") return defaultContent;
      const row = props.row.columns;
      const id = row[args.rowKeyColumn];
      if (typeof id !== "string" && typeof id !== "number") {
        return defaultContent;
      }
      return createElement(RowLabel, {
        data: rowData.table(args.tableName),
        id,
        label: rowLabelOf(row, args.labelColumns, id),
        row,
        labelContent: defaultContent,
        context: {
          as: "self",
          surface: "cell",
          density: "compact",
          source: {
            table: args.tableName,
            column: String(args.gridColumn.id),
            levelPath: props.path,
          },
          hierarchyShown: args.display?.hierarchyShown ?? false,
        },
      });
    },
  };
}

// A cell drawn by its column's slot, over what the column draws without it.
function columnSlotColumnFor(
  rowData: RowDataStore,
  slot: ColumnSlot,
  args: {
    tableName: string;
    column: TableColumnSchema;
    rowKeyColumn: string;
    gridColumn: GridColumnSchema;
    display?: TGridColumnDisplay;
  },
): GridColumnSchema {
  const base = args.gridColumn.renderCell;
  const referenced = args.column.foreignKey?.table;
  const meta = args.gridColumn.meta;
  return {
    ...args.gridColumn,
    // A slot may draw from computed values when the column's own value is
    // empty, so narrow cards keep the field.
    ...(slot.render && isRecord(meta)
      ? { meta: { ...meta, cardHideWhenEmpty: false } }
      : {}),
    renderCell: (props: CellRenderProps) => {
      const defaultContent = base(props);
      if (props.row.kind !== "data") return defaultContent;
      const row = props.row.columns;
      const id = row[args.rowKeyColumn];
      if (typeof id !== "string" && typeof id !== "number") {
        return defaultContent;
      }
      return createElement(ColumnSlotCell, {
        data: rowData.table(args.tableName),
        slot,
        id,
        value: props.value,
        row,
        defaultContent,
        ...(referenced ? { reference: rowData.table(referenced) } : {}),
        context: {
          as: "self",
          surface: "cell",
          density: "compact",
          source: {
            table: args.tableName,
            column: args.column.name,
            levelPath: props.path,
          },
          hierarchyShown: args.display?.hierarchyShown ?? false,
        },
      });
    },
  };
}

// The server's row label rule: the non-empty label column values joined by a
// space, else the primary key.
function rowLabelOf(
  row: Readonly<Record<string, unknown>>,
  labelColumns: readonly string[],
  id: string | number,
): string {
  const parts = labelColumns
    .map((name) => row[name])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(String);
  return parts.length > 0 ? parts.join(" ") : String(id);
}

function presetColumnFor(
  lookups: LookupStore,
  rowData: RowDataStore | undefined,
  args: {
    tableName: string;
    column: TableColumnSchema;
    immutable: boolean;
    display?: TGridColumnDisplay;
  },
): GridColumnSchema {
  const { tableName, column, immutable } = args;
  const displayType = inferDisplayType(column);
  const editable =
    !immutable &&
    isGridEditableColumn(column) &&
    displayType !== "pk" &&
    displayType !== "date" &&
    displayType !== "timestamp";
  const common = {
    id: column.name as ColId,
    name: column.label,
    edit: editable ? ("default" as const) : ("none" as const),
    // Delete and Backspace store null in an editable cell. A required column
    // turns this off, and the picker or editor remains the way to change it.
    ...(column.notNull ? { disableBackspaceCellClear: true as const } : {}),
    parse: (draft: string) => {
      const parsed = parseTablePatchValueDraft(column, draft);
      // TGrid's codec returns a value rather than a local field-issue result.
      // Preserve invalid text so the generated patch reaches authoritative
      // server validation and the editor does not silently clear the draft.
      return parsed.ok ? parsed.value : draft;
    },
    width: tableColumnPresetWidth(column),
    meta: {
      table: tableName,
      schema: column,
      displayType,
      cardHideWhenEmpty: true,
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
      const referenced = column.foreignKey?.table;
      return columnPreset.foreignKey({
        ...common,
        valueLookup: lookup.valueLookup,
        searchLookup: lookup.searchLookup,
        ...(rowData && referenced
          ? {
              renderEntry: referenceEntryRenderer({
                data: rowData.table(referenced),
                source: { table: tableName, column: column.name },
                hierarchyShown: args.display?.hierarchyShown ?? false,
              }),
            }
          : {}),
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
        edit: "none",
      });
    case "timestamp":
      return columnPreset.timestamp({
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
