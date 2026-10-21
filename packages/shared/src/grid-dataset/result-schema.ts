import { z } from "zod";
import { navLinkSchema } from "../contracts/meta-schema.js";
import { computedValuesSchema } from "../contracts/table-schema.js";

export const gridDatasetColumnKindSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "timestamp",
]);
export type GridDatasetColumnKind = z.output<
  typeof gridDatasetColumnKindSchema
>;

/** The table rows a report column names. */
export const gridDatasetColumnReferenceSchema = z.object({
  /** SQL name of the referenced table. */
  table: z.string(),
  /** Column of the level holding the referenced row's id. */
  idColumn: z.string(),
});
export type GridDatasetColumnReference = z.output<
  typeof gridDatasetColumnReferenceSchema
>;

export const gridDatasetColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: gridDatasetColumnKindSchema,
  displayFormat: z.enum(["currency", "percentage"]).optional(),
  textDisplay: z.enum(["multiLine", "markdown"]).optional(),
  visuallyHidden: z.boolean().optional(),
  width: z.number().optional(),
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  colorRule: z.enum(["positive", "negative", "signed"]).optional(),
  zeroDisplay: z.enum(["blank", "dot"]).optional(),
  strong: z.boolean().optional(),
  notes: z.string().optional(),
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  searchable: z.boolean().optional(),
  /** Declarative drill-down links for this column's cells. `bind` sources
   *  read from the row's `columns` values (hidden helper ID columns work).
   *  The first resolvable link renders as the cell's primary link; all
   *  resolvable links appear in the right-click context menu. */
  links: z.array(navLinkSchema).optional(),
  /** The table row each cell of this column names, such as the account of
   *  a ledger line. The cell's value stays the label text, chosen by the
   *  report's SQL. `idColumn` names the row column holding the row's id,
   *  usually visually hidden, as for `links`. The grid draws the cell with
   *  the table's row display, such as its `label` slot. */
  reference: gridDatasetColumnReferenceSchema.optional(),
});
export type GridDatasetColumn = z.output<typeof gridDatasetColumnSchema>;

export const gridDatasetFooterRowSchema = z.object({
  rowKey: z.string(),
  columns: z.record(z.string(), z.unknown()),
});
export type GridDatasetFooterRow = z.output<typeof gridDatasetFooterRowSchema>;

export type GridDatasetNode = {
  rowKey: string;
  levelName: string;
  columns: Record<string, unknown>;
  rollup?: Record<string, unknown>;
  children?: Record<string, GridDatasetNode[]>;
  childFooterRows?: Record<string, GridDatasetFooterRow[]>;
  kind?: "opening" | "closing" | "subtotal";
};

export const gridDatasetNodeSchema: z.ZodType<GridDatasetNode> = z.lazy(() =>
  z.object({
    rowKey: z.string(),
    levelName: z.string(),
    columns: z.record(z.string(), z.unknown()),
    rollup: z.record(z.string(), z.unknown()).optional(),
    children: z.record(z.string(), z.array(gridDatasetNodeSchema)).optional(),
    childFooterRows: z
      .record(z.string(), z.array(gridDatasetFooterRowSchema))
      .optional(),
    kind: z.enum(["opening", "closing", "subtotal"]).optional(),
  }),
);

/**
 * Rows of one level that refer to each other, such as accounts with a
 * `parent_id`, shown as one tree under the level's header.
 */
export const gridDatasetLevelTreeSchema = z.object({
  /** Column of the level holding the parent row's `rowKey`. `null`,
   *  `undefined`, and `""` mark a top-level row. Values are compared with
   *  row keys as strings. The column may be visually hidden. */
  parentColumn: z.string(),
  /** Visible column that shows the hierarchy. Default: the first visible
   *  text column, else the first visible column. */
  column: z.string().optional(),
});
export type GridDatasetLevelTree = z.output<typeof gridDatasetLevelTreeSchema>;

export const gridDatasetLevelSchema = z.object({
  label: z.string().optional(),
  columns: z.array(gridDatasetColumnSchema),
  childLevels: z.array(z.string()),
  /** Rows of this level start collapsed. On a tree level, every tree row
   *  starts collapsed. */
  defaultCollapsed: z.boolean().optional(),
  /** Shows the level's rows as one tree. A tree level declares no
   *  `childLevels`, and its nodes are one flat list in which each node names
   *  its parent through `tree.parentColumn`. */
  tree: gridDatasetLevelTreeSchema.optional(),
  /** Declarative row-level links for this level (related data, drill-into).
   *  Resolvable links appear in the row's right-click context menu. */
  rowLinks: z.array(navLinkSchema).optional(),
});
export type GridDatasetLevel = z.output<typeof gridDatasetLevelSchema>;

export const gridDatasetSchema = z.object({
  name: z.string(),
  label: z.string(),
  rootLevel: z.string(),
  levels: z.record(z.string(), gridDatasetLevelSchema),
  nodes: z.array(gridDatasetNodeSchema),
  footerRows: z.array(gridDatasetFooterRowSchema).optional(),
  /** Computed field values of the rows that `reference` columns name, by
   *  table name: field name, then row id, then value. The grid stores them
   *  before it draws, so label slots draw without a further request.
   *  `attachReferenceComputed()` in `@sapporta/server` fills it. */
  computed: z.record(z.string(), computedValuesSchema).optional(),
});
export type GridDataset = z.output<typeof gridDatasetSchema>;
