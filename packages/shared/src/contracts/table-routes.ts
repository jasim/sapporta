/**
 * Loose, table-name-generic CRUD contracts under `/tables/:tableName`.
 *
 * Per-table specialization happens server-side via `registerFamily` in
 * `mount-tables.ts`: one Hono route per operation that dispatches at
 * request time and fans out into per-table OpenAPI entries at doc time.
 *
 * The contracts here mirror those paths with envelopes from
 * `./table-schema.ts` — same wire format, table-agnostic types — and
 * are what `@sapporta/ui` and other generic clients consume through
 * `uiContract`.
 *
 * `lookupRoute` and `countRoute` are registered verbatim as static
 * (non-family) routes by the server since their response shapes don't
 * vary by table.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "./error.js";
import {
  countQuerySchema,
  countResponseSchema,
  listRowsQuerySchema,
  lookupQuerySchema,
  lookupResponseSchema,
  paginatedRowsSchema,
  rowSchema,
  singleRowSchema,
} from "./table-schema.js";

const c = initContract();

const tableNameParam = z.object({ tableName: z.string() });
const tableRowParam = z.object({ tableName: z.string(), id: z.string() });

export const listRowsRoute = c.query({
  method: "GET",
  path: "/tables/:tableName",
  summary: "List rows for any table",
  metadata: { tags: ["tables"] },
  pathParams: tableNameParam,
  query: listRowsQuerySchema,
  responses: {
    200: paginatedRowsSchema,
    400: errorBodySchema,
    404: errorBodySchema,
    410: errorBodySchema,
  },
});

export const getRowRoute = c.query({
  method: "GET",
  path: "/tables/:tableName/:id",
  summary: "Get one row by id",
  metadata: { tags: ["tables"] },
  pathParams: tableRowParam,
  responses: {
    200: singleRowSchema,
    404: errorBodySchema,
    410: errorBodySchema,
  },
});

export const createRowRoute = c.mutation({
  method: "POST",
  path: "/tables/:tableName",
  summary: "Create a row (or rows) in any table",
  metadata: { tags: ["tables"], skipBodyValidation: true },
  pathParams: tableNameParam,
  body: z.union([rowSchema, z.array(rowSchema)]),
  responses: {
    201: z.object({ data: z.union([rowSchema, z.array(rowSchema)]) }),
    404: errorBodySchema,
    410: errorBodySchema,
    422: errorBodySchema,
    500: errorBodySchema,
  },
});

export const updateRowRoute = c.mutation({
  method: "PUT",
  path: "/tables/:tableName/:id",
  summary: "Update a row by id",
  metadata: { tags: ["tables"], skipBodyValidation: true },
  pathParams: tableRowParam,
  body: rowSchema,
  responses: {
    200: singleRowSchema,
    403: errorBodySchema,
    404: errorBodySchema,
    410: errorBodySchema,
    422: errorBodySchema,
  },
});

export const deleteRowRoute = c.mutation({
  method: "DELETE",
  path: "/tables/:tableName/:id",
  summary: "Delete a row by id",
  metadata: { tags: ["tables"] },
  pathParams: tableRowParam,
  body: c.noBody(),
  responses: {
    200: singleRowSchema,
    403: errorBodySchema,
    404: errorBodySchema,
    410: errorBodySchema,
  },
});

export const lookupRoute = c.query({
  method: "GET",
  path: "/tables/:tableName/_lookup",
  summary: "Lookup FK display values for a table",
  metadata: { tags: ["tables"] },
  pathParams: tableNameParam,
  query: lookupQuerySchema,
  responses: {
    200: lookupResponseSchema,
    404: errorBodySchema,
    410: errorBodySchema,
  },
});

export const countRoute = c.query({
  method: "GET",
  path: "/tables/:tableName/_count",
  summary: "Grouped child counts for a table",
  metadata: { tags: ["tables"] },
  pathParams: tableNameParam,
  query: countQuerySchema,
  responses: {
    200: countResponseSchema,
    400: errorBodySchema,
    404: errorBodySchema,
    410: errorBodySchema,
  },
});
