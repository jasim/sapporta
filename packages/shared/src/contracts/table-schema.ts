import { z } from "zod";

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

/** FK display-value lookup entries. */
export const lookupEntrySchema = z.object({
  value: lookupValueSchema,
  label: z.string(),
});
export type LookupEntry = z.output<typeof lookupEntrySchema>;

export const lookupResponseSchema = z.object({
  entries: z.array(lookupEntrySchema),
});
export type LookupResponse = z.output<typeof lookupResponseSchema>;

/** Grouped child counts: { parentId → child count }. */
export const countResponseSchema = z.object({
  data: z.record(z.string(), z.number()),
});
export type CountResponse = z.output<typeof countResponseSchema>;

/** Query shape for the row-listing endpoint. Filters are encoded as
 *  additional `f.*` keys (see `@sapporta/shared/filter`); the contract
 *  uses `.loose()` so those pass through validation. */
export const listRowsQuerySchema = z
  .object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    q: z.string().optional(),
  })
  .loose();
export type ListRowsQuery = z.output<typeof listRowsQuerySchema>;

export const lookupQuerySchema = z.object({
  ids: z.string().optional(),
  q: z.string().optional(),
  limit: z.string().optional(),
});
export type LookupQuery = z.output<typeof lookupQuerySchema>;

export const countQuerySchema = z.object({
  group_by: z.string(),
  ids: z.string(),
});
export type CountQuery = z.output<typeof countQuerySchema>;
