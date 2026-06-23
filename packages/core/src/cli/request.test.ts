import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRequest } from "./request.js";
import { ROUTES, type CliRoute } from "./routes.js";
import { ErrorCode, OperationError } from "../introspect/types.js";

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
      { ...postRoute, bodyFlags: { sql: {} } },
      {},
      {
        "api-token": "secret-token",
        sql: "SELECT 1",
      },
    );

    expect(req.body).toEqual({ sql: "SELECT 1" });
  });

  it("throws INVALID_JSON for malformed --input-body-json", () => {
    expect(() =>
      buildRequest(postRoute, {}, { "input-body-json": '{"sql":' }),
    ).toThrow(OperationError);
    expect(() =>
      buildRequest(postRoute, {}, { "input-body-json": '{"sql":' }),
    ).toThrow("Invalid JSON");
  });

  it("throws VALIDATION_FAILED for schema-built request failures", () => {
    try {
      buildRequest(
        { ...postRoute, bodyFlags: { sql: {}, limit: {} } },
        {},
        { sql: "SELECT 1", limit: "10" },
      );
      throw new Error("Expected buildRequest to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it("throws MISSING_ARGUMENT before HTTP when required body fields are absent", () => {
    try {
      buildRequest(
        { ...postRoute, bodyFlags: { limit: {} }, requiredBodyFields: ["sql"] },
        {},
        { limit: "10" },
      );
      throw new Error("Expected buildRequest to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.MISSING_ARGUMENT });
    }
  });

  it("parses typed body flags declared by the matched route", () => {
    const route = ROUTES.find(
      (candidate) => candidate.pattern.join(" ") === "db exec-sql",
    );
    expect(route).toBeDefined();

    const req = buildRequest(route!, {}, {
      _: ["SELECT name FROM accounts WHERE type = ?"],
      limit: "10",
      params: '["asset"]',
      "dry-run": "true",
    });

    expect(req.body).toEqual({
      sql: "SELECT name FROM accounts WHERE type = ?",
      limit: 10,
      params: ["asset"],
      dryRun: true,
    });
  });

  it("throws BAD_LIMIT for invalid typed limit body flags", () => {
    const route = ROUTES.find(
      (candidate) => candidate.pattern.join(" ") === "db exec-sql",
    );
    expect(route).toBeDefined();

    try {
      buildRequest(route!, {}, { _: ["SELECT 1"], limit: "abc" });
      throw new Error("Expected buildRequest to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.BAD_LIMIT });
    }
  });

  it("rejects flags that the matched route does not forward", () => {
    const getRoute: CliRoute = {
      pattern: ["rows", ":table"],
      description: "List rows",
      method: "GET",
      path: "/api/tables/:table",
      params: ["table"],
      queryFlags: ["limit", "page", "sort", "q"],
      allowFilterFlags: true,
      extractData: () => [],
    };

    try {
      buildRequest(getRoute, { table: "accounts" }, { order: "desc" });
      throw new Error("Expected buildRequest to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    }
  });

  it("forwards supported row query and filter flags", () => {
    const getRoute: CliRoute = {
      pattern: ["rows", ":table"],
      description: "List rows",
      method: "GET",
      path: "/api/tables/:table",
      params: ["table"],
      queryFlags: ["limit", "page", "sort", "q"],
      allowFilterFlags: true,
      extractData: () => [],
    };

    const req = buildRequest(
      getRoute,
      { table: "accounts" },
      {
        limit: "25",
        q: "cash",
        "filter[type][eq]": "asset",
      },
    );

    expect(req.queryParams).toEqual({
      limit: "25",
      q: "cash",
      "filter[type][eq]": "asset",
    });
  });
});
