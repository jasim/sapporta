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
    const req = buildRequest(postRoute, {}, {
      "input-body-json": '{"sql":"SELECT * FROM accounts","limit":50}',
    });

    expect(req.body).toEqual({
      sql: "SELECT * FROM accounts",
      limit: 50,
    });
  });

  it("does not forward --output-format or --input-body-json as query params", () => {
    const getRoute: CliRoute = {
      pattern: ["reports", "run", ":report"],
      description: "Run report",
      method: "GET",
      path: "/api/reports/:report/results",
      params: ["report"],
      queryFlags: ["*"],
      extractData: () => [],
    };

    const req = buildRequest(getRoute, { report: "trial-balance" }, {
      "output-format": "json",
      "input-body-json": '{"ignored":true}',
      period: "2026-05",
    });

    expect(req.queryParams).toEqual({ period: "2026-05" });
  });
});
