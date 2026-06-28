import { z } from "zod";
import { init } from "../init.js";
import {
  endpointListResult,
  endpointShowResult,
} from "../openapi/endpoints.js";
import type {
  CliCommandContext,
  CliCommandResult,
  CliCommandSpec,
} from "./types.js";
import {
  jsonOption,
  optionalJsonArray,
  optionalJsonObject,
  optionalPositiveInteger,
  readDataRows,
  readRecordArrayResponse,
  readTableListRows,
  requiredString,
  resultFromResponse,
} from "./helpers.js";

const apiBodyOptions = [
  {
    name: "query",
    flag: "--query <json>",
    description: "JSON object to send as query parameters",
    kind: "string" as const,
  },
  {
    name: "body",
    flag: "--body <json>",
    description: "JSON request body",
    kind: "string" as const,
  },
] as const;

const apiBodySchema = z.object({
  path: requiredString("path"),
  query: optionalJsonObject("query"),
  body: jsonOption("body").optional(),
});

export const CLI_COMMANDS: readonly CliCommandSpec[] = [
  command({
    name: ["init"],
    summary: "Create a new Sapporta project directory",
    args: [{ name: "name", required: true }],
    inputSchema: z.object({ name: requiredString("name") }),
    examples: ["sapporta init my-app"],
    run: async (input) => {
      const result = await init([input.name]);
      if (!result.ok) {
        throw new Error(result.error);
      }
      return {
        data: result.data,
        message: result.meta?.message,
        raw: result,
      };
    },
  }),

  command({
    name: ["endpoints", "list"],
    summary: "List HTTP endpoints exposed by the selected app",
    inputSchema: z.object({}),
    examples: ["sapporta endpoints list"],
    run: async (_input, context) =>
      endpointListResult(context.apiUrl, context.apiToken),
  }),
  command({
    name: ["endpoints", "show"],
    summary: "Show one endpoint's parameters, request body, and responses",
    args: [{ name: "endpoint", required: true }],
    inputSchema: z.object({ endpoint: requiredString("endpoint") }),
    examples: ['sapporta endpoints show "POST /api/tables/books"'],
    run: async (input, context) =>
      endpointShowResult(context.apiUrl, context.apiToken, input.endpoint),
  }),

  command({
    name: ["api", "get"],
    summary: "Call an app endpoint with GET",
    args: [{ name: "path", required: true }],
    options: [
      {
        name: "query",
        flag: "--query <json>",
        description: "JSON object to send as query parameters",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      path: requiredString("path"),
      query: optionalJsonObject("query"),
    }),
    examples: ["sapporta api get /api/tables/books --query '{\"limit\":50}'"],
    run: apiCommand("GET"),
  }),
  command({
    name: ["api", "post"],
    summary: "Call an app endpoint with POST",
    args: [{ name: "path", required: true }],
    options: [...apiBodyOptions],
    inputSchema: apiBodySchema,
    examples: [
      'sapporta api post /api/custom-route --body \'{"field":"value"}\'',
    ],
    run: apiCommand("POST"),
  }),
  command({
    name: ["api", "put"],
    summary: "Call an app endpoint with PUT",
    args: [{ name: "path", required: true }],
    options: [...apiBodyOptions],
    inputSchema: apiBodySchema,
    examples: [
      'sapporta api put /api/custom-route/123 --body \'{"field":"value"}\'',
    ],
    run: apiCommand("PUT"),
  }),
  command({
    name: ["api", "delete"],
    summary: "Call an app endpoint with DELETE",
    args: [{ name: "path", required: true }],
    options: [
      {
        name: "query",
        flag: "--query <json>",
        description: "JSON object to send as query parameters",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      path: requiredString("path"),
      query: optionalJsonObject("query"),
    }),
    examples: ["sapporta api delete /api/custom-route/123"],
    run: apiCommand("DELETE"),
  }),

  command({
    name: ["tables", "list"],
    summary: "List table definitions",
    options: [
      {
        name: "detail",
        flag: "--detail",
        description: "Include full metadata for each table",
        kind: "boolean",
      },
    ],
    inputSchema: z.object({ detail: z.boolean().optional() }),
    examples: ["sapporta tables list", "sapporta tables list --detail"],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.listTables(input.detail === true),
        readTableListRows,
      ),
  }),
  command({
    name: ["tables", "show"],
    summary: "Show table schema",
    args: [{ name: "table", required: true }],
    inputSchema: z.object({ table: requiredString("table") }),
    examples: ["sapporta tables show books"],
    run: async (input, context) =>
      resultFromResponse(await context.client.showTable(input.table), (res) => {
        if (!res || typeof res !== "object" || Array.isArray(res)) return [];
        const record = res as Record<string, unknown>;
        if (!Array.isArray(record.columns)) return [record];
        return record.columns
          .filter((column): column is Record<string, unknown> =>
            Boolean(
              column && typeof column === "object" && !Array.isArray(column),
            ),
          )
          .map((column) => ({
            column: column.name,
            type: column.dataType ?? "",
            notNull: column.notNull ? "YES" : "",
            pk: column.primary ? "YES" : "",
            default: column.hasDefault ? "YES" : "",
          }));
      }),
  }),
  command({
    name: ["tables", "indexes"],
    summary: "Show table indexes",
    args: [{ name: "table", required: true }],
    inputSchema: z.object({ table: requiredString("table") }),
    examples: ["sapporta tables indexes books"],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.tableIndexes(input.table),
        readRecordArrayResponse,
      ),
  }),
  command({
    name: ["tables", "sample"],
    summary: "Show sample rows for inspection",
    args: [{ name: "table", required: true }],
    options: [
      {
        name: "limit",
        flag: "--limit <number>",
        description: "Maximum number of sample rows",
        kind: "string",
      },
      {
        name: "columns",
        flag: "--columns <columns>",
        description: "Comma-separated column names to include",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      limit: optionalPositiveInteger("limit"),
      columns: z.string().optional(),
    }),
    examples: [
      "sapporta tables sample books --limit 10 --columns title,author",
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.sampleTable(input.table, {
          limit: input.limit,
          columns: input.columns,
        }),
        readRecordArrayResponse,
      ),
  }),

  command({
    name: ["rows", "list"],
    summary: "List records from a table",
    args: [{ name: "table", required: true }],
    options: [
      {
        name: "limit",
        flag: "--limit <number>",
        description: "Rows per page",
        kind: "string",
      },
      {
        name: "page",
        flag: "--page <number>",
        description: "Page number",
        kind: "string",
      },
      {
        name: "sort",
        flag: "--sort <columns>",
        description: 'Sort columns, e.g. "-created_at,name"',
        kind: "string",
      },
      {
        name: "q",
        flag: "--q <term>",
        description: "Search term",
        kind: "string",
      },
      {
        name: "where",
        flag: "--where <json>",
        description: "JSON filter object",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      limit: optionalPositiveInteger("limit"),
      page: optionalPositiveInteger("page"),
      sort: z.string().optional(),
      q: z.string().optional(),
      where: optionalJsonObject("where"),
    }),
    examples: [
      'sapporta rows list books --limit 50 --sort "-created_at,title"',
      'sapporta rows list books --where \'{"status":{"eq":"active"}}\'',
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.listRows(input.table, {
          limit: input.limit,
          page: input.page,
          sort: input.sort,
          q: input.q,
          where: input.where,
        }),
        readDataRows,
      ),
  }),
  command({
    name: ["rows", "get"],
    summary: "Get one record by ID",
    args: [
      { name: "table", required: true },
      { name: "id", required: true },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      id: requiredString("id"),
    }),
    examples: ["sapporta rows get books 123"],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.getRow(input.table, input.id),
        readDataRows,
      ),
  }),
  command({
    name: ["rows", "create"],
    summary: "Create one or more records in a table",
    args: [{ name: "table", required: true }],
    options: [
      {
        name: "values",
        flag: "--values <json>",
        description: "JSON object or array of objects to create",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      values: jsonOption("values"),
    }),
    examples: [
      'sapporta rows create books --values \'{"title":"Relativity"}\'',
      'sapporta rows create books --values \'[{"title":"A"},{"title":"B"}]\'',
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.createRows(input.table, input.values),
        readDataRows,
      ),
  }),
  command({
    name: ["rows", "update"],
    summary: "Update one record by ID",
    args: [
      { name: "table", required: true },
      { name: "id", required: true },
    ],
    options: [
      {
        name: "values",
        flag: "--values <json>",
        description: "JSON object containing fields to update",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      id: requiredString("id"),
      values: jsonOption("values"),
    }),
    examples: [
      'sapporta rows update books 123 --values \'{"author":"Albert Einstein"}\'',
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.updateRow(input.table, input.id, input.values),
        readDataRows,
      ),
  }),
  command({
    name: ["rows", "delete"],
    summary: "Delete one record by ID",
    args: [
      { name: "table", required: true },
      { name: "id", required: true },
    ],
    inputSchema: z.object({
      table: requiredString("table"),
      id: requiredString("id"),
    }),
    examples: ["sapporta rows delete books 123"],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.deleteRow(input.table, input.id),
        readDataRows,
      ),
  }),

  command({
    name: ["sql", "query"],
    summary: "Run SQL that returns rows",
    args: [{ name: "sql", required: true }],
    options: [
      {
        name: "params",
        flag: "--params <json>",
        description: "JSON array of bound parameter values",
        kind: "string",
      },
      {
        name: "limit",
        flag: "--limit <number>",
        description: "Maximum rows returned",
        kind: "string",
      },
    ],
    inputSchema: z.object({
      sql: requiredString("sql"),
      params: optionalJsonArray("params"),
      limit: optionalPositiveInteger("limit"),
    }),
    examples: [
      'sapporta sql query "SELECT id, name FROM accounts" --limit 50',
      'sapporta sql query "SELECT * FROM accounts WHERE type = ?" --params \'["asset"]\'',
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.sqlQuery(input.sql, {
          params: input.params,
          limit: input.limit,
        }),
        readDataRows,
      ),
  }),
  command({
    name: ["sql", "execute"],
    summary: "Run SQL that changes data or schema",
    args: [{ name: "sql", required: true }],
    options: [
      {
        name: "params",
        flag: "--params <json>",
        description: "JSON array of bound parameter values",
        kind: "string",
      },
      {
        name: "dryRun",
        flag: "--dry-run",
        description: "Validate the statement without executing it",
        kind: "boolean",
      },
    ],
    inputSchema: z.object({
      sql: requiredString("sql"),
      params: optionalJsonArray("params"),
      dryRun: z.boolean().optional(),
    }),
    examples: [
      'sapporta sql execute "UPDATE accounts SET name = ? WHERE id = ?" --params \'["Cash",1]\' --dry-run',
    ],
    run: async (input, context) =>
      resultFromResponse(
        await context.client.sqlExecute(input.sql, {
          params: input.params,
          dryRun: input.dryRun,
        }),
        readDataRows,
      ),
  }),
];

type HttpMethodForApi = "GET" | "POST" | "PUT" | "DELETE";

function apiCommand(method: HttpMethodForApi) {
  return async (
    input: { path: string; query?: Record<string, unknown>; body?: unknown },
    context: CliCommandContext,
  ): Promise<CliCommandResult> => {
    const response = await context.client.request(method, input.path, {
      query: input.query,
      body: input.body,
    });
    return resultFromResponse(response, readDataRows);
  };
}

function command<TInput extends Record<string, unknown>>(spec: {
  name: CliCommandSpec["name"];
  summary: string;
  args?: CliCommandSpec["args"];
  options?: CliCommandSpec["options"];
  examples?: CliCommandSpec["examples"];
  inputSchema: z.ZodType<TInput>;
  run(input: TInput, context: CliCommandContext): Promise<CliCommandResult>;
}): CliCommandSpec {
  return {
    ...spec,
    inputSchema: spec.inputSchema,
    run: async (input, context) =>
      spec.run(spec.inputSchema.parse(input), context),
  };
}
