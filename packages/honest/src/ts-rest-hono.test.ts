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
