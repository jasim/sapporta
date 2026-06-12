import { z } from "zod";

export const gridColumnSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(["text", "number", "boolean", "date", "timestamp"]).optional(),
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
  clientEditable: z.boolean().optional(),
});
export type GridColumn = z.output<typeof gridColumnSchema>;

export const gridFooterRowSchema = z.object({
  label: z.string(),
  columns: z.record(z.string(), z.unknown()),
});
export type GridFooterRow = z.output<typeof gridFooterRowSchema>;

export const gridReportNodeSchema: z.ZodType<GridReportNode> = z.lazy(() =>
  z.object({
    levelName: z.string(),
    columns: z.record(z.string(), z.unknown()),
    rollup: z.record(z.string(), z.unknown()).optional(),
    children: z
      .record(
        z.string(),
        z.union([
          z.array(gridReportNodeSchema),
          gridReportNodeSchema,
          z.null(),
        ]),
      )
      .optional(),
    childFooterRows: z
      .record(z.string(), z.array(gridFooterRowSchema))
      .optional(),
    kind: z.enum(["opening", "closing", "subtotal"]).optional(),
  }),
);
export type GridReportNode = {
  levelName: string;
  columns: Record<string, unknown>;
  rollup?: Record<string, unknown>;
  children?: Record<string, GridReportNode[] | GridReportNode | null>;
  childFooterRows?: Record<string, GridFooterRow[]>;
  kind?: "opening" | "closing" | "subtotal";
};

export const gridReportStatSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(["fg", "positive", "negative", "brand", "muted"]).optional(),
  strong: z.boolean().optional(),
});
export type GridReportStat = z.output<typeof gridReportStatSchema>;

export const gridReportResultSchema = z.object({
  name: z.string(),
  label: z.string(),
  columns: z.array(gridColumnSchema),
  levelColumns: z.record(z.string(), z.array(gridColumnSchema)),
  data: z.array(gridReportNodeSchema),
  levelOptions: z
    .record(z.string(), z.object({ defaultCollapsed: z.boolean().optional() }))
    .optional(),
  footerRows: z.array(gridFooterRowSchema).optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
  stats: z.array(gridReportStatSchema).optional(),
});
export type GridReportResult = z.output<typeof gridReportResultSchema>;
