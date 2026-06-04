import { z } from "zod";
import { valueKindSchema } from "./value-kind-schema.js";

/**
 * Wire shapes for `/meta/*` introspection responses.
 *
 * The server's `extractSchemas` (in `@sapporta/server/schema/extract.ts`)
 * emits values that conform to these schemas; the UI consumes them as
 * `TableSchema[]`. Single source of truth — both sides import the type
 * from here.
 *
 * Report definitions in `@sapporta/server/reports/report.ts` use a
 * superset of `ColumnSchema` that adds a runtime `display` function;
 * that's a separate authoring type, not a wire shape, and lives in core.
 */

/** Maps target (table filter / report param) name → source column name on
 *  the current row. */
export const linkBindSchema = z.record(z.string(), z.string());
export type LinkBind = z.output<typeof linkBindSchema>;

/** Visual hint for which icon the UI should render.
 *  - drill-up:   jump to a single referenced row (FK drill-up)
 *  - drill-into: browse a filtered collection (master→children)
 *  - report:     open another report */
export const linkIconSchema = z.enum(["drill-up", "drill-into", "report"]);
export type LinkIcon = z.output<typeof linkIconSchema>;

export const reportLinkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("table"),
    table: z.string(),
    bind: linkBindSchema,
    label: z.string().optional(),
    icon: linkIconSchema.optional(),
  }),
  z.object({
    kind: z.literal("report"),
    report: z.string(),
    bind: linkBindSchema,
    label: z.string().optional(),
    icon: linkIconSchema.optional(),
  }),
]);
export type ReportLink = z.output<typeof reportLinkSchema>;

export const foreignKeyRefSchema = z.object({
  table: z.string(),
  column: z.string(),
});

export const selectOptionsSchema = z.object({
  options: z.array(z.string()),
});

export const columnSchemaSchema = z.object({
  name: z.string(),
  header: z.string().optional(),
  kind: valueKindSchema.optional(),
  displayFormat: z.enum(["currency", "percentage"]).optional(),
  textDisplay: z.enum(["multiLine", "markdown"]).optional(),

  dataType: z.string().optional(),
  primary: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  notNull: z.boolean().optional(),
  hasDefault: z.boolean().optional(),
  foreignKey: foreignKeyRefSchema.nullable().optional(),
  select: selectOptionsSchema.nullable().optional(),
  visuallyHidden: z.boolean().optional(),
  width: z.number().optional(),
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  colorRule: z.enum(["positive", "negative", "signed"]).optional(),
  zeroDisplay: z.enum(["blank", "dot"]).optional(),
  strong: z.boolean().optional(),
  notes: z.string().optional(),
  clientEditable: z.boolean().optional(),
  links: z.array(reportLinkSchema).optional(),
});
export type ColumnSchema = z.output<typeof columnSchemaSchema>;

export const childSchemaSchema = z.object({
  table: z.string(),
  foreignKey: z.string(),
  label: z.string(),
  columns: z.array(z.string()),
  defaultSort: z.string(),
  width: z.number().optional(),
});
export type ChildSchema = z.output<typeof childSchemaSchema>;

export const tableSchemaSchema = z.object({
  name: z.string(),
  label: z.string(),
  immutable: z.boolean(),
  columns: z.array(columnSchemaSchema),
  children: z.array(childSchemaSchema),
  rowLinks: z.array(reportLinkSchema).optional(),
  rowLabelColumns: z.array(z.string()).optional(),
  rowCount: z.number().optional(),
  search: z.object({ columns: z.array(z.string()) }).optional(),
});
export type TableSchema = z.output<typeof tableSchemaSchema>;

export const projectInfoSchema = z.object({
  slug: z.string(),
});
export type ProjectInfo = z.output<typeof projectInfoSchema>;
