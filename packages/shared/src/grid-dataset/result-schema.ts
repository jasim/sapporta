import { z } from "zod";

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
});
export type GridDatasetLevel = z.output<typeof gridDatasetLevelSchema>;

export const gridDatasetStatSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(["fg", "positive", "negative", "brand", "muted"]).optional(),
  strong: z.boolean().optional(),
});
export type GridDatasetStat = z.output<typeof gridDatasetStatSchema>;

export const gridDatasetPageSchema = z.object({
  nodes: z.array(gridDatasetNodeSchema),
  totalCount: z.number().int().nonnegative().optional(),
  footerRows: z.array(gridDatasetFooterRowSchema).optional(),
});
export type GridDatasetPage = z.output<typeof gridDatasetPageSchema>;

export const gridDatasetSchema = z.object({
  name: z.string(),
  label: z.string(),
  rootLevel: z.string(),
  levels: z.record(z.string(), gridDatasetLevelSchema),
  nodes: z.array(gridDatasetNodeSchema),
  totalCount: z.number().int().nonnegative().optional(),
  footerRows: z.array(gridDatasetFooterRowSchema).optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
  stats: z.array(gridDatasetStatSchema).optional(),
});
export type GridDataset = z.output<typeof gridDatasetSchema>;
