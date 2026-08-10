import { z } from "zod";
import { valueKindSchema } from "./value-kind-schema.js";

/**
 * Wire shapes for `/meta/*` introspection responses.
 *
 * The server's `extractSchemas` (in `@sapporta/server/schema/extract.ts`)
 * emits values that conform to these schemas. The UI parses the HTTP response
 * with the same Zod definitions before treating it as `TableSchema[]`.
 *
 * `ColumnSchema.kind` is required because metadata-driven display, filtering,
 * create-draft decoding, and grid patch decoding all branch on it. The server
 * guarantees the value during extraction; the wire parser prevents incomplete
 * or stale metadata from silently reaching those consumers.
 *
 * Table metadata and route-based grid datasets use separate wire types.
 * Grid dataset columns live in `@sapporta/shared/grid-dataset`.
 */

/** Maps target (table filter / report param / URL query param) name → source
 *  column name on the current row. */
export const linkBindSchema = z.record(z.string(), z.string());
export type LinkBind = z.output<typeof linkBindSchema>;

/** Visual hint for which icon the UI should render.
 *  - drill-up:   jump to a single referenced row (FK drill-up)
 *  - drill-into: browse a filtered collection (master→children)
 *  - report:     open another report
 *  - external:   leave the app (arbitrary URL) */
export const linkIconSchema = z.enum([
  "drill-up",
  "drill-into",
  "report",
  "external",
]);
export type LinkIcon = z.output<typeof linkIconSchema>;

export const linkTargetSchema = z.enum(["_self", "_blank"]);
export type LinkTarget = z.output<typeof linkTargetSchema>;

/**
 * A declarative navigation link carried by schema metadata and report
 * datasets. `bind` names the values the destination needs, sourced from the
 * current row: for `table` links each entry becomes an equality filter on the
 * destination table; for `report` links each entry becomes a query parameter
 * on the report route; for `url` links each entry becomes a query parameter
 * on the given href (which may also embed `{column}` placeholders).
 *
 * A link only resolves when every bound source value is present on the row —
 * rows with NULL sources simply don't offer that link.
 */
export const navLinkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("table"),
    table: z.string(),
    bind: linkBindSchema,
    label: z.string().optional(),
    icon: linkIconSchema.optional(),
    target: linkTargetSchema.optional(),
  }),
  z.object({
    kind: z.literal("report"),
    /** Report route: either an absolute app path ("/reports/aging") or a
     *  bare report name resolved as "/reports/<name>". */
    report: z.string(),
    bind: linkBindSchema,
    label: z.string().optional(),
    icon: linkIconSchema.optional(),
    target: linkTargetSchema.optional(),
  }),
  z.object({
    kind: z.literal("url"),
    /** Destination href. `{column}` placeholders are substituted with the
     *  row's URL-encoded values. */
    href: z.string(),
    bind: linkBindSchema.optional(),
    label: z.string().optional(),
    icon: linkIconSchema.optional(),
    target: linkTargetSchema.optional(),
  }),
]);
export type NavLink = z.output<typeof navLinkSchema>;

export const foreignKeyRefSchema = z.object({
  table: z.string(),
  column: z.string(),
});

export const selectOptionsSchema = z.object({
  options: z.array(z.string()),
});

export const columnSchemaSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: valueKindSchema,
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
  apiWritable: z.boolean().optional(),
  links: z.array(navLinkSchema).optional(),
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
  rowLinks: z.array(navLinkSchema).optional(),
  rowLabelColumns: z.array(z.string()).nonempty(),
  rowCount: z.number().optional(),
  searchable: z.boolean(),
});
export type TableSchema = z.output<typeof tableSchemaSchema>;

export const projectInfoSchema = z.object({
  name: z.string(),
  slug: z.string(),
});
export type ProjectInfo = z.output<typeof projectInfoSchema>;
