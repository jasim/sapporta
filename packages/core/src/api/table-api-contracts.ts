/**
 * Per-table ts-rest routes.
 *
 * `tableApiZod` describes one table value. Transport-only create unions and
 * response envelopes stay local to these routes. Create is the HTTP operation;
 * insert is the one-row value accepted within a create body. This distinction
 * keeps master-detail and array envelopes out of reusable table-value schemas.
 *
 * Response bodies use the `{ data, meta? }` envelope the generated table
 * handlers return. Tests and CLI
 * consumers depend on `body.data` being the row (or row array) and
 * `body.meta` being the paging envelope.
 *
 * One concrete `AppRoute` exists per table and operation. The tables-namespace
 * mount in `mount-tables.ts` emits all routes for OpenAPI and dispatches to the
 * matching table handler at request time.
 *
 * Generated create and update routes skip adapter body validation. Auth must
 * inspect the caller payload and add trusted fields before the authoritative
 * write schema can validate an insert. `scopedRows()` and `savePipeline()`
 * preserve the generated API's structured 422 validation response.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import {
  errorBodySchema,
  exportRowsQuerySchema,
  listMetaSchema,
  listRowsQuerySchema,
} from "@sapporta/shared/contracts";
import type { TableDef } from "../schema/table.js";
import { tableZodComponentId } from "../schema/table-value-zod.js";
import { tableApiZod } from "./table-api-zod.js";

const c = initContract();

type ApiPayloadZod = z.ZodType;

export function listRoute(def: TableDef) {
  const row = tableApiZod.forRow(def);
  return c.query({
    method: "GET",
    path: `/tables/${def.sqlName}`,
    summary: `List rows in ${def.sqlName}`,
    metadata: { tags: ["tables"] },
    query: listRowsQuerySchema,
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
      200: z.object({ data: tableApiZod.forRow(def) }),
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
    body: createBodyZod(def, tables),
    responses: {
      201: createResultZod(def, tables),
      404: errorBodySchema,
      409: errorBodySchema,
      422: errorBodySchema,
      500: errorBodySchema,
    },
  });
}

export function updateRoute(def: TableDef, tables: readonly TableDef[]) {
  return c.mutation({
    method: "PUT",
    path: `/tables/${def.sqlName}/:id`,
    summary: `Update a row in ${def.sqlName}`,
    // Updates use the same save-boundary validation path as creates. Adapter
    // validation would duplicate parsing and convert the structured 422 into a
    // generic request-body 400.
    metadata: { tags: ["tables"], skipBodyValidation: true },
    pathParams: z.object({ id: z.string() }),
    // The generated transport currently uses PUT, while the accepted value is
    // patch-shaped: any writable subset may be supplied.
    body: tableApiZod.forPatch(def, tables),
    responses: {
      200: z.object({ data: tableApiZod.forRow(def) }),
      403: errorBodySchema,
      404: errorBodySchema,
      409: errorBodySchema,
      422: errorBodySchema,
      500: errorBodySchema,
    },
  });
}

function findChild(
  master: TableDef,
  tables: readonly TableDef[],
  name: string,
): TableDef {
  const child = tables.find((candidate) => candidate.sqlName === name);
  if (!child) {
    throw new Error(
      `Table ${master.sqlName} declares child "${name}" but no matching TableDef was provided`,
    );
  }
  return child;
}

function unionOf(
  branches: ApiPayloadZod[],
  componentId: string,
): ApiPayloadZod {
  if (branches.length === 1) return branches[0]!;
  return z
    .union(branches as [ApiPayloadZod, ApiPayloadZod, ...ApiPayloadZod[]])
    .meta({ id: componentId });
}

/**
 * Drops the master-detail foreign key from a child's insert shape.
 *
 * The key is often already absent: `tableApiZod.forInsert` excludes any
 * column the API may not write, and a server-owned FK (`apiSettable: false`
 * on the reference, or `apiWritable: false` on the column) is exactly that.
 * Zod 4 throws `Unrecognized key` from the lazy `shape` getter when `.omit()`
 * names a key the object does not carry, which surfaces only during
 * JSON-schema conversion — i.e. when OpenAPI is generated, not here.
 */
function omitField(
  schema: z.ZodObject<z.ZodRawShape>,
  field: string,
): z.ZodObject<z.ZodRawShape> {
  return field in schema.shape ? schema.omit({ [field]: true }) : schema;
}

function createBodyZod(
  master: TableDef,
  tables: readonly TableDef[],
): ApiPayloadZod {
  const masterInsert = tableApiZod.forInsert(master, tables);
  const branches: ApiPayloadZod[] = [
    masterInsert,
    z
      .array(masterInsert)
      .meta({ id: tableZodComponentId(master, "CreateInputArray") }),
  ];

  for (const child of master.meta.children) {
    const childDef = findChild(master, tables, child.table);
    const childInsert = omitField(
      tableApiZod.forInsert(childDef, tables),
      child.foreignKey,
    );
    branches.push(
      masterInsert
        .extend({
          $details: z
            .object({
              table: z.literal(childDef.sqlName),
              fk: z.literal(child.foreignKey),
              rows: z.array(childInsert),
            })
            .strict(),
        })
        .strict()
        .meta({
          id: tableZodComponentId(
            master,
            `CreateWith${tableZodComponentId(child.table, "")}`,
          ),
        }),
    );
  }
  return unionOf(branches, tableZodComponentId(master, "CreateBody"));
}

function createResultZod(
  master: TableDef,
  tables: readonly TableDef[],
): ApiPayloadZod {
  const row = tableApiZod.forRow(master);
  const branches: ApiPayloadZod[] = [
    row,
    z.array(row).meta({ id: tableZodComponentId(master, "RowArray") }),
  ];
  for (const child of master.meta.children) {
    const childDef = findChild(master, tables, child.table);
    branches.push(
      z
        .object({
          master: row,
          details: z.array(tableApiZod.forRow(childDef)),
        })
        .strict()
        .meta({
          id: tableZodComponentId(
            master,
            `CreateWith${tableZodComponentId(child.table, "")}Result`,
          ),
        }),
    );
  }
  return z
    .object({
      data: unionOf(branches, tableZodComponentId(master, "CreatePayload")),
    })
    .meta({ id: tableZodComponentId(master, "CreateOutput") });
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
      200: z.object({ data: tableApiZod.forRow(def) }),
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
    query: exportRowsQuerySchema,
    responses: {
      200: c.otherResponse({ contentType: "text/csv", body: z.string() }),
      400: errorBodySchema,
    },
  });
}

// Loose routes that don't specialize per table — `lookupRoute` and
// `countRoute` — live in `@sapporta/shared/contracts` since their wire
// shape is the same regardless of which table you hit; `mount-tables.ts`
// imports them from there.
