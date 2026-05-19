import { z } from "zod";
import { columnSchemaSchema, reportLinkSchema } from "./meta-schema.js";

/**
 * Wire shapes for `/reports` and `/reports/:name/results`.
 *
 * The execution result is recursively-tree-shaped because the engine
 * builds per-level output from each report's own SQL sources — concrete
 * columns vary per level per report. We type the envelope (params,
 * level columns, top-level metadata) and use a recursive `z.lazy` for
 * the per-level node tree.
 *
 * Report definitions in `@sapporta/server/reports/report.ts` describe
 * the *author DSL* — function fields (`transform`, `rollup`, `display`)
 * that don't survive JSON. That's a separate type that lives in core.
 */

export const paramTypeSchema = z.enum([
  "date",
  "string",
  "integer",
  "float",
  "daterange",
]);
export type ParamType = z.output<typeof paramTypeSchema>;

export const reportParamSchema = z.object({
  name: z.string(),
  type: paramTypeSchema,
  required: z.boolean(),
  default: z.unknown().optional(),
  label: z.string().optional(),
  lookup: z.string().optional(),
  fromBind: z.string().optional(),
  toBind: z.string().optional(),
});
export type ReportParam = z.output<typeof reportParamSchema>;

export const reportMetaSchema = z.object({
  name: z.string(),
  label: z.string(),
  params: z.array(reportParamSchema),
});
export type ReportMeta = z.output<typeof reportMetaSchema>;

export const reportFooterRowSchema = z.object({
  label: z.string(),
  columns: z.record(z.string(), z.unknown()),
});
export type ReportFooterRow = z.output<typeof reportFooterRowSchema>;

/** Recursive: each node may carry singular or list children of the same shape. */
export const reportOutputNodeSchema: z.ZodType<ReportOutputNode> = z.lazy(() =>
  z.object({
    levelName: z.string(),
    columns: z.record(z.string(), z.unknown()),
    rollup: z.record(z.string(), z.unknown()).optional(),
    children: z
      .record(
        z.string(),
        z.union([
          z.array(reportOutputNodeSchema),
          reportOutputNodeSchema,
          z.null(),
        ]),
      )
      .optional(),
    childFooterRows: z
      .record(z.string(), z.array(reportFooterRowSchema))
      .optional(),
    kind: z.enum(["opening", "closing", "subtotal"]).optional(),
  }),
);
export type ReportOutputNode = {
  levelName: string;
  columns: Record<string, unknown>;
  rollup?: Record<string, unknown>;
  children?: Record<
    string,
    ReportOutputNode[] | ReportOutputNode | null
  >;
  childFooterRows?: Record<string, ReportFooterRow[]>;
  kind?: "opening" | "closing" | "subtotal";
};

export const serializedReportStatSchema = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(["fg", "positive", "negative", "brand", "muted"]).optional(),
  strong: z.boolean().optional(),
});
export type SerializedReportStat = z.output<typeof serializedReportStatSchema>;

export const reportResultSchema = z.object({
  name: z.string(),
  label: z.string(),
  params: z.array(reportParamSchema),
  columns: z.array(columnSchemaSchema),
  levelColumns: z.record(z.string(), z.array(columnSchemaSchema)),
  data: z.array(reportOutputNodeSchema),
  levelOptions: z
    .record(z.string(), z.object({ defaultCollapsed: z.boolean().optional() }))
    .optional(),
  levelLinks: z.record(z.string(), z.array(reportLinkSchema)).optional(),
  footerRows: z.array(reportFooterRowSchema).optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
  stats: z.array(serializedReportStatSchema).optional(),
});
export type ReportResult = z.output<typeof reportResultSchema>;

export const reportsListResponseSchema = z.object({
  reports: z.array(reportMetaSchema),
});
export type ReportsListResponse = z.output<typeof reportsListResponseSchema>;
