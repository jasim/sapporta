/**
 * Per-table ts-rest routes.
 *
 * Zod derivation (row / insert / create-body / create-result shapes)
 * lives in `table-schemas.ts`; those helpers produce plain Zod schemas,
 * which ts-rest accepts directly.
 *
 * Response bodies use the `{ data, meta? }` envelope the generated table
 * handlers return. Tests and CLI
 * consumers depend on `body.data` being the row (or row array) and
 * `body.meta` being the paging envelope.
 *
 * One concrete `AppRoute` per table × operation; the tables-namespace
 * mount (see `mount-tables.ts`) emits all of them at doc time and
 * dispatches to the matching one at request time.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import type { TableDef } from "../schema/table.js";
import {
  tableCreateBodySchemaFor,
  tableCreateResultSchemaFor,
  tableRowSchemaFor,
} from "./table-schemas.js";

const c = initContract();

const listMetaSchema = z.object({
  total: z.number(),
  page: z.number().optional(),
  limit: z.number(),
  pages: z.number().optional(),
  offset: z.number().optional(),
});

const looseObject = z.record(z.string(), z.unknown());

export function listRoute(def: TableDef) {
  const row = tableRowSchemaFor(def);
  return c.query({
    method: "GET",
    path: `/tables/${def.sqlName}`,
    summary: `List rows in ${def.sqlName}`,
    metadata: { tags: ["tables"] },
    query: z
      .object({
        limit: z.coerce.number().int().positive().max(1000).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
        page: z.coerce.number().int().positive().optional(),
        sort: z.string().optional(),
        q: z.string().optional(),
      })
      .loose(),
    responses: {
      200: z.object({ data: z.array(row), meta: listMetaSchema }),
      400: errorBodySchema,
      404: errorBodySchema,
    },
  });
}

export function getRoute(def: TableDef) {
  return c.query({
    method: "GET",
    path: `/tables/${def.sqlName}/:id`,
    summary: `Get one row from ${def.sqlName}`,
    metadata: { tags: ["tables"] },
    pathParams: z.object({ id: z.string() }),
    responses: {
      200: z.object({ data: tableRowSchemaFor(def) }),
      404: errorBodySchema,
    },
  });
}

export function createRoute(def: TableDef, tables: readonly TableDef[]) {
  return c.mutation({
    method: "POST",
    path: `/tables/${def.sqlName}`,
    summary: `Create row(s) in ${def.sqlName}`,
    description: def.meta.children.length
      ? `Object, array, or master-with-$details payload for ${def.sqlName}.`
      : `Object or array of rows for ${def.sqlName}.`,
    // `skipBodyValidation` is a Sapporta-specific route-metadata flag
    // consumed by `ts-rest-hono.ts::execute`. The generated table handler
    // calls `scopedRows()`; its writes go through `savePipeline()` and
    // return 422 on failure. Validating again at the adapter would
    // short-circuit with a 400 and lose the canonical envelope.
    metadata: { tags: ["tables"], skipBodyValidation: true },
    body: tableCreateBodySchemaFor(def, tables),
    responses: {
      201: tableCreateResultSchemaFor(def, tables),
      404: errorBodySchema,
      422: errorBodySchema,
      500: errorBodySchema,
    },
  });
}

export function updateRoute(def: TableDef) {
  return c.mutation({
    method: "PUT",
    path: `/tables/${def.sqlName}/:id`,
    summary: `Update a row in ${def.sqlName}`,
    metadata: { tags: ["tables"], skipBodyValidation: true },
    pathParams: z.object({ id: z.string() }),
    body: looseObject,
    responses: {
      200: z.object({ data: tableRowSchemaFor(def) }),
      403: errorBodySchema,
      404: errorBodySchema,
      422: errorBodySchema,
    },
  });
}

export function deleteRoute(def: TableDef) {
  return c.mutation({
    method: "DELETE",
    path: `/tables/${def.sqlName}/:id`,
    summary: `Delete a row from ${def.sqlName}`,
    metadata: { tags: ["tables"] },
    pathParams: z.object({ id: z.string() }),
    body: c.noBody(),
    responses: {
      200: z.object({ data: tableRowSchemaFor(def) }),
      403: errorBodySchema,
      404: errorBodySchema,
    },
  });
}

export function exportCsvRoute(def: TableDef) {
  return c.query({
    method: "GET",
    path: `/tables/${def.sqlName}/export.csv`,
    summary: `Export ${def.sqlName} rows as CSV`,
    metadata: { tags: ["tables"] },
    responses: {
      200: c.otherResponse({ contentType: "text/csv", body: z.string() }),
    },
  });
}

// Loose routes that don't specialize per table — `lookupRoute` and
// `countRoute` — live in `@sapporta/shared/contracts` since their wire
// shape is the same regardless of which table you hit; `mount-tables.ts`
// imports them from there.
