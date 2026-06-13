import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRequest } from "./request.js";
import type { CliRoute } from "./routes.js";

describe("buildRequest", () => {
  const postRoute: CliRoute = {
    pattern: ["db", "exec-sql"],
    description: "Execute raw SQL",
    method: "POST",
    path: "/api/meta/sql",
    params: [],
    inputSchema: z.object({
      sql: z.string(),
      limit: z.number().optional(),
    }),
    extractData: () => [],
  };

  it("uses --input-body-json as the request body for mutating commands", () => {
    const req = buildRequest(
      postRoute,
      {},
      {
        "input-body-json": '{"sql":"SELECT * FROM accounts","limit":50}',
      },
    );

    expect(req.body).toEqual({
      sql: "SELECT * FROM accounts",
      limit: 50,
    });
  });

  it("does not forward --output-format or --input-body-json as query params", () => {
    const getRoute: CliRoute = {
      pattern: ["rows", ":table"],
      description: "List rows",
      method: "GET",
      path: "/api/tables/:table",
      params: ["table"],
      queryFlags: ["*"],
      extractData: () => [],
    };

    const req = buildRequest(
      getRoute,
      { table: "accounts" },
      {
        "output-format": "json",
        "input-body-json": '{"ignored":true}',
        limit: "25",
      },
    );

    expect(req.queryParams).toEqual({ limit: "25" });
  });

  it("does not forward --api-token as a query param", () => {
    const getRoute: CliRoute = {
      pattern: ["rows", ":table"],
      description: "List rows",
      method: "GET",
      path: "/api/tables/:table",
      params: ["table"],
      queryFlags: ["*"],
      extractData: () => [],
    };

    const req = buildRequest(
      getRoute,
      { table: "customers" },
      {
        "api-token": "secret-token",
        limit: "10",
      },
    );

    expect(req.queryParams).toEqual({ limit: "10" });
  });

  it("does not forward --api-token into schema-built request bodies", () => {
    const req = buildRequest(
      postRoute,
      {},
      {
        "api-token": "secret-token",
        sql: "SELECT 1",
      },
    );

    expect(req.body).toEqual({ sql: "SELECT 1" });
  });
});
