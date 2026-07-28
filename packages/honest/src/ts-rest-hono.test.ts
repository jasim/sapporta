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
        .object({ page: z.string().optional() })
        .catchall(z.union([z.string(), z.array(z.string()).min(1)])),
      responses: {
        200: z.object({
          page: z.string(),
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
          page: request.query.page ?? "",
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
      page: "2",
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
