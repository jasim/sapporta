import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import type { Env } from "hono";
import { TsRestApi } from "./ts-rest-hono.js";

describe("TsRestApi.extend", () => {
  it("composes a context-free API into an API with document context", () => {
    const c = initContract();
    const statusRoute = c.query({
      method: "GET",
      path: "/status",
      responses: {
        200: z.object({ ok: z.boolean() }),
      },
    });
    const child = new TsRestApi();
    child.register("status", statusRoute, () => ({
      status: 200,
      body: { ok: true },
    }));
    const parent = new TsRestApi<Env, { tables: readonly string[] }>();

    parent.extend(child);

    const document = parent.generateDocument(
      { tables: [] },
      { info: { title: "Test", version: "1" } },
    ) as { paths: Record<string, unknown> };
    expect(document.paths["/status"]).toBeDefined();
  });
});

describe("TsRestApi query parsing", () => {
  it("keeps singleton values scalar and repeated values lossless", async () => {
    const c = initContract();
    const route = c.query({
      method: "GET",
      path: "/rows",
      query: z
        .object({ page: z.coerce.number().int().min(1).optional() })
        .catchall(z.union([z.string(), z.array(z.string()).min(1)])),
      responses: {
        200: z.object({
          page: z.number(),
          filters: z.array(z.string()),
        }),
      },
    });
    const api = new TsRestApi();
    api.register("rows", route, ({ request }) => {
      const filters = request.query["filter[name][contains]"];
      return {
        status: 200,
        body: {
          page: request.query.page ?? 1,
          filters: typeof filters === "string" ? [filters] : filters,
        },
      };
    });

    const response = await api.request(
      "/rows?page=2&filter%5Bname%5D%5Bcontains%5D=left" +
        "&filter%5Bname%5D%5Bcontains%5D=right",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      page: 2,
      filters: ["left", "right"],
    });
  });

  it("rejects repeated fields declared as singletons", async () => {
    const c = initContract();
    const route = c.query({
      method: "GET",
      path: "/rows",
      query: z.object({ page: z.string().optional() }),
      responses: { 200: z.object({ ok: z.literal(true) }) },
    });
    const api = new TsRestApi();
    api.register("rows", route, () => ({
      status: 200,
      body: { ok: true as const },
    }));

    const response = await api.request("/rows?page=1&page=2");

    expect(response.status).toBe(400);
  });
});

describe("TsRestApi body parsing", () => {
  function deleteApi(body: z.ZodTypeAny) {
    const c = initContract();
    const route = c.mutation({
      method: "DELETE",
      path: "/rows/:id",
      body,
      responses: { 200: z.object({ deleted: z.number() }) },
    });
    const api = new TsRestApi();
    api.register("deleteRow", route, () => ({
      status: 200,
      body: { deleted: 1 },
    }));
    return api;
  }

  it("accepts an empty body when the contract's body is optional", async () => {
    const api = deleteApi(z.object({}).optional());

    const response = await api.request("/rows/4", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
  });

  it("reports an empty required body as a validation error", async () => {
    const api = deleteApi(z.object({ reason: z.string() }));

    const response = await api.request("/rows/4", { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("still rejects malformed JSON", async () => {
    const api = deleteApi(z.object({}).optional());

    const response = await api.request("/rows/4", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_JSON" });
  });
});
