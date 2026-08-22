import { ErrorCode, OperationError } from "../../errors.js";
import { httpRequest, type HttpMethod } from "../http-client.js";
import type { OpenApiDoc } from "../openapi-spec.js";
import type { ApiTarget } from "../runtime-config.js";
import type { CountQuery } from "@sapporta/shared/contracts";

export interface RowListOptions {
  limit?: number;
  page?: number;
  sort?: string;
  q?: string;
  where?: Record<string, unknown>;
}

interface CountRowsBaseOptions {
  where?: Record<string, unknown>;
}

export type CountRowsOptions =
  | (CountRowsBaseOptions & {
      groupBy?: undefined;
      order?: undefined;
      limit?: undefined;
    })
  | (CountRowsBaseOptions & {
      groupBy: string;
      order?: CountQuery["order"];
      limit?: CountQuery["limit"];
    });

export interface SqlQueryOptions {
  params?: unknown[];
  limit?: number;
}

export interface SqlExecuteOptions {
  params?: unknown[];
  dryRun?: boolean;
}

export class SapportaCliClient {
  constructor(private readonly target: ApiTarget) {}

  /**
   * Call the deployment and return the response payload.
   *
   * Non-2xx replies and unreachable servers arrive as `ApiRequestError`, so
   * every method below can treat its return value as a success.
   */
  async request(
    method: HttpMethod,
    path: string,
    opts: { body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    return httpRequest(this.target, method, path, {
      body: opts.body,
      queryParams: opts.query ? queryObjectToParams(opts.query) : undefined,
    });
  }

  /** Fetch the app contract describing every endpoint this deployment serves. */
  async openApiSpec(): Promise<OpenApiDoc> {
    return (await this.request("GET", "/api/openapi.json")) as OpenApiDoc;
  }

  async listTables(detail: boolean): Promise<unknown> {
    return this.request("GET", "/api/meta/tables", {
      query: detail ? { detail: "full" } : undefined,
    });
  }

  async showTable(table: string): Promise<unknown> {
    return this.request("GET", `/api/meta/tables/${encodePathSegment(table)}`);
  }

  async tableIndexes(table: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/meta/tables/${encodePathSegment(table)}/indexes`,
    );
  }

  async sampleTable(
    table: string,
    opts: { limit?: number; columns?: string },
  ): Promise<unknown> {
    return this.request(
      "GET",
      `/api/meta/tables/${encodePathSegment(table)}/sample`,
      {
        query: {
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...(opts.columns ? { fields: opts.columns } : {}),
        },
      },
    );
  }

  async listRows(table: string, opts: RowListOptions): Promise<unknown> {
    return this.request("GET", `/api/tables/${encodePathSegment(table)}`, {
      query: rowListQuery(opts),
    });
  }

  async getRow(table: string, id: string): Promise<unknown> {
    return this.request(
      "GET",
      `/api/tables/${encodePathSegment(table)}/${encodePathSegment(id)}`,
    );
  }

  async countRows(
    table: string,
    opts: CountRowsOptions = {},
  ): Promise<unknown> {
    if (opts.groupBy === "") {
      throw new OperationError(
        "--group-by must not be empty",
        ErrorCode.VALIDATION_FAILED,
      );
    }
    return this.request(
      "GET",
      `/api/tables/${encodePathSegment(table)}/_count`,
      {
        query: {
          ...(opts.groupBy !== undefined ? { group_by: opts.groupBy } : {}),
          ...(opts.order ? { order: opts.order } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          ...whereObjectToFilterParams(opts.where),
        },
      },
    );
  }

  async createRows(table: string, values: unknown): Promise<unknown> {
    return this.request("POST", `/api/tables/${encodePathSegment(table)}`, {
      body: values,
    });
  }

  async updateRow(
    table: string,
    id: string,
    values: unknown,
  ): Promise<unknown> {
    return this.request(
      "PUT",
      `/api/tables/${encodePathSegment(table)}/${encodePathSegment(id)}`,
      { body: values },
    );
  }

  async deleteRow(table: string, id: string): Promise<unknown> {
    return this.request(
      "DELETE",
      `/api/tables/${encodePathSegment(table)}/${encodePathSegment(id)}`,
    );
  }

  async sqlQuery(sql: string, opts: SqlQueryOptions): Promise<unknown> {
    return this.request("POST", "/api/meta/sql", {
      body: {
        sql,
        ...(opts.params ? { params: opts.params } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      },
    });
  }

  async sqlExecute(sql: string, opts: SqlExecuteOptions): Promise<unknown> {
    return this.request("POST", "/api/meta/sql", {
      body: {
        sql,
        allowDangerous: true,
        ...(opts.params ? { params: opts.params } : {}),
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      },
    });
  }
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function rowListQuery(opts: RowListOptions): Record<string, unknown> {
  return {
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    ...(opts.page !== undefined ? { page: opts.page } : {}),
    ...(opts.sort ? { sort: opts.sort } : {}),
    ...(opts.q ? { q: opts.q } : {}),
    ...whereObjectToFilterParams(opts.where),
  };
}

export function whereObjectToFilterParams(
  where: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!where) return {};
  const query: Record<string, string> = {};
  for (const [column, clause] of Object.entries(where)) {
    if (!isRecord(clause)) {
      throw new OperationError(
        `Filter for ${JSON.stringify(column)} must be an object of operators`,
        ErrorCode.VALIDATION_FAILED,
      );
    }
    for (const [operator, value] of Object.entries(clause)) {
      query[`filter[${column}][${operator}]`] = filterValueToString(value);
    }
  }
  return query;
}

function filterValueToString(value: unknown): string {
  if (Array.isArray(value)) return value.map(filterValueToString).join(",");
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  throw new OperationError(
    "Filter values must be strings, numbers, booleans, null, or arrays of those values",
    ErrorCode.VALIDATION_FAILED,
  );
}

function queryObjectToParams(
  query: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    out[key] = filterValueToString(value);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
