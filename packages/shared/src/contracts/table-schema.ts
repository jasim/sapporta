import { z } from "zod";
import { MAX_COUNT_GROUPS, type GroupCount } from "../count.js";
import type { QueryParamValue } from "../query-params.js";

/**
 * Wire shapes for `/tables/:tableName/*` envelopes (the loose,
 * name-generic surface the UI consumes).
 *
 * Per-table specialization is the server's job — `mount-tables.ts`
 * fans the per-table response schemas into the OpenAPI spec via
 * `registerFamily`. The schemas in this file describe what the wire
 * looks like once you don't know the table at the call site.
 */

/** A row, as it appears on the wire. Columns are user-defined per-table,
 *  so the wire shape is unavoidably loose. The UI carries the same shape
 *  through grids and forms; per-table column metadata lives in
 *  `tableSchemaSchema` (see `meta-schema.ts`). */
export const rowSchema = z.record(z.string(), z.unknown());
export type Row = z.output<typeof rowSchema>;

export const listMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  pages: z.number(),
});
export type ListMeta = z.output<typeof listMetaSchema>;

export const paginatedRowsSchema = z.object({
  data: z.array(rowSchema),
  meta: listMetaSchema,
});
export type PaginatedRows = z.output<typeof paginatedRowsSchema>;

export const singleRowSchema = z.object({ data: rowSchema });
export type SingleRow = z.output<typeof singleRowSchema>;

const lookupValueSchema = z.union([z.string(), z.number()]);

/** FK display-value lookup entries with the source row available to renderers. */
export const lookupEntrySchema = z.object({
  value: lookupValueSchema,
  label: z.string(),
  meta: rowSchema,
});
export type LookupEntry = z.output<typeof lookupEntrySchema>;

export const lookupResponseSchema = z.object({
  entries: z.array(lookupEntrySchema),
});
export type LookupResponse = z.output<typeof lookupResponseSchema>;

const rowSelectionQueryShape = {
  sort: z.string().optional(),
  q: z.string().optional(),
};

const filterQueryValueSchema: z.ZodType<QueryParamValue> = z.union([
  z.string(),
  z.array(z.string()).min(1),
]);

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;
export const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_PAGE_SIZE);
export const DEFAULT_LOOKUP_LIMIT = 50;
export const MAX_LOOKUP_LIMIT = 500;
export const MAX_LOOKUP_IDS = 500;

/** Query shape shared by reads that select rows without pagination.
 *  Filters are additional `filter[col][op]` keys. Repeated filter keys remain
 *  arrays until the strict table query resolver validates their grammar. */
export const exportRowsQuerySchema = z
  .object(rowSelectionQueryShape)
  .catchall(filterQueryValueSchema);
export type ExportRowsQuery = z.output<typeof exportRowsQuerySchema>;

/** Query shape for the paged row-listing endpoint. */
export const listRowsQuerySchema = z
  .object({
    ...rowSelectionQueryShape,
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .catchall(filterQueryValueSchema);
export type ListRowsQuery = z.output<typeof listRowsQuerySchema>;

const lookupIdsQuerySchema = z
  .string()
  .transform((value) => value.split(",").map((id) => id.trim()))
  .pipe(z.array(z.string().min(1)).min(1).max(MAX_LOOKUP_IDS));

const lookupByIdsQuerySchema = z
  .object({
    ids: lookupIdsQuerySchema,
    q: z.never().optional(),
    fields: z.never().optional(),
    limit: z.never().optional(),
  })
  .strict();

const lookupBySearchQuerySchema = z
  .object({
    ids: z.never().optional(),
    q: z.string().optional(),
    fields: z.string().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LOOKUP_LIMIT)
      .default(DEFAULT_LOOKUP_LIMIT),
  })
  .strict();

export const lookupQuerySchema = z.union([
  lookupByIdsQuerySchema,
  lookupBySearchQuerySchema,
]);
export type LookupQuery = z.output<typeof lookupQuerySchema>;

const countGroupValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const groupCountSchema: z.ZodType<GroupCount> = z.object({
  value: countGroupValueSchema,
  count: z.number().int().nonnegative(),
});
export type { GroupCount } from "../count.js";

export const countResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("total"),
    count: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("grouped"),
    groups: z.array(groupCountSchema).max(MAX_COUNT_GROUPS),
  }),
]);
export type CountResult = z.output<typeof countResultSchema>;

export const countResponseSchema = z.object({
  data: countResultSchema,
});
export type CountResponse = z.output<typeof countResponseSchema>;

/**
 * Count visible rows after applying canonical `filter[col][op]` parameters.
 *
 * Without `group_by`, the response contains one total. Grouped counts default
 * to descending count order and a bounded result.
 */
export const countQuerySchema = z
  .object({
    group_by: z.string().min(1).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_COUNT_GROUPS).optional(),
  })
  .catchall(filterQueryValueSchema);
export type CountQuery = z.output<typeof countQuerySchema>;
