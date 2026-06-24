/**
 * `/meta/*` routes. Bodies and response envelopes are typed against the
 * concrete zod schemas in `./meta-schema.ts`; index/sample/sql payloads
 * stay loose because their shapes are driver-specific or schema-dependent.
 */

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "./error.js";
import { projectInfoSchema, tableSchemaSchema } from "./meta-schema.js";

const c = initContract();

const sqlBodySchema = z.object({
  sql: z.string(),
  params: z.array(z.unknown()).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  dryRun: z.boolean().optional(),
  allowDangerous: z.boolean().optional(),
});

export const projectInfoRoute = c.query({
  method: "GET",
  path: "/meta/info",
  summary: "Project identity",
  metadata: { tags: ["meta"] },
  responses: {
    200: projectInfoSchema,
  },
});

export const listTablesRoute = c.query({
  method: "GET",
  path: "/meta/tables",
  summary: "List all tables registered in the runtime",
  metadata: { tags: ["meta"] },
  query: z.object({ detail: z.enum(["full"]).optional() }),
  responses: {
    200: z.object({ tables: z.array(tableSchemaSchema) }),
    403: errorBodySchema,
  },
});

export const getTableRoute = c.query({
  method: "GET",
  path: "/meta/tables/:name",
  summary: "Describe a single table",
  metadata: { tags: ["meta"] },
  pathParams: z.object({ name: z.string() }),
  responses: {
    200: tableSchemaSchema,
    404: errorBodySchema,
  },
});

export const tableIndexesRoute = c.query({
  method: "GET",
  path: "/meta/tables/:name/indexes",
  summary: "List indexes for a table",
  metadata: { tags: ["meta"] },
  pathParams: z.object({ name: z.string() }),
  responses: {
    200: z.array(z.record(z.string(), z.unknown())),
    400: errorBodySchema,
    403: errorBodySchema,
    404: errorBodySchema,
  },
});

export const tableSampleRoute = c.query({
  method: "GET",
  path: "/meta/tables/:name/sample",
  summary: "Sample rows from a table",
  metadata: { tags: ["meta"] },
  pathParams: z.object({ name: z.string() }),
  query: z.object({
    limit: z.string().optional(),
    fields: z.string().optional(),
  }),
  responses: {
    200: z.array(z.record(z.string(), z.unknown())),
    400: errorBodySchema,
    403: errorBodySchema,
    404: errorBodySchema,
  },
});

export const sqlRoute = c.mutation({
  method: "POST",
  path: "/meta/sql",
  summary: "Run a SQL statement (auto-dispatches reads vs writes)",
  description:
    "Escape hatch for ad-hoc SQL. Statements that return rows (SELECT, WITH, PRAGMA, EXPLAIN) return those rows. Mutating statements require `allowDangerous: true` and report the row-change count. Use `params` for placeholders — never string-concatenate user input into `sql`.",
  metadata: {
    tags: ["meta"],
    extensions: { "x-sapporta-risk": "escape-hatch" },
  },
  body: sqlBodySchema,
  responses: {
    200: z.array(z.record(z.string(), z.unknown())),
    400: errorBodySchema,
    403: errorBodySchema,
    409: errorBodySchema,
    422: errorBodySchema,
    500: errorBodySchema,
  },
});
