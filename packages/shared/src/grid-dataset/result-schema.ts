import { z } from "zod";
import { navLinkSchema } from "../contracts/meta-schema.js";

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

export const gridDatasetLevelSchema = z.object({
  label: z.string().optional(),
  columns: z.array(gridDatasetColumnSchema),
  childLevels: z.array(z.string()),
  defaultCollapsed: z.boolean().optional(),
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
});
export type GridDataset = z.output<typeof gridDatasetSchema>;
