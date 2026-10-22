/**
 * Smoke test for IMPL-3: verify the ported built-in sub-apps are fully
 * registered in the served `/openapi.json`. This is the thin safety net
 * for the port — it catches a half-finished port that ships green because
 * no other test happens to inspect the generated spec.
 *
 * Scope deliberately narrow:
 *  - built-in paths present (/api/meta/tables, /api/meta/sql)
 *  - every operation has ≥1 2xx response entry
 *
 * Reports are ordinary app routes now, so the framework spec should not expose
 * a registry or generic report runner.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  gridDatasetSchema,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
import { initContract } from "./index.js";
import { createIntegrationApp } from "../integration/setup.js";
import { resolveRefs, type OpenApiDoc } from "../cli/openapi-spec.js";

async function createServedApp() {
  const { app } = await createIntegrationApp();
  return app;
}

describe("openapi smoke — built-in sub-apps in /openapi.json", () => {
  it("served spec includes the stable built-in paths", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/meta/tables"]).toBeDefined();
    expect(spec.paths["/api/meta/sql"]).toBeDefined();
    expect(spec.paths["/api/reports"]).toBeUndefined();
  });

  it("specializes dynamic table templates", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, any>>;
    };

    // The loose templates must not survive into the served document.
    expect(spec.paths["/api/tables/{tableName}"]).toBeUndefined();

    // The accounts fixture yields concrete /api/tables/accounts operations
    // with a real row schema on create. The create body is a union (row |
    // array<row>) whose parts zod names, so they are components the body
    // refers to. Resolved as the CLI resolves them for an agent, the row
    // schema's `name` column survived specialization.
    const fullSpec = spec as unknown as OpenApiDoc & {
      paths: Record<string, any>;
    };
    expect(fullSpec.paths["/api/tables/accounts"]).toBeDefined();
    expect(fullSpec.paths["/api/tables/{tableName}/_count"]).toBeDefined();
    const post = fullSpec.paths["/api/tables/accounts"].post;
    const schema = resolveRefs(
      post.requestBody.content["application/json"].schema,
      fullSpec,
    );
    const branches = schema.anyOf ?? schema.oneOf ?? [schema];
    const objectBranch = branches.find(
      (b: any) => b?.type === "object" && b.properties,
    );
    expect(objectBranch).toBeDefined();
    expect(objectBranch.properties?.name).toBeDefined();
  });

  it("keeps every schema ref resolvable in the served document", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    const spec = (await res.json()) as OpenApiDoc;
    const text = JSON.stringify(spec);

    // zod writes a schema's shared parts as `definitions` beside it; in an
    // OpenAPI document they belong in the components, where refs find them.
    expect(text).not.toMatch(/"(definitions|\$defs)":/);
    const refs = [...text.matchAll(/"\$ref":"([^"]*)"/g)].map((m) => m[1]!);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/components\/schemas\//);
      const target = ref
        .slice(2)
        .split("/")
        .reduce<any>((node, part) => node?.[part], spec);
      expect(target, ref).toBeDefined();
    }
  });

  it("every registered operation has at least one 2xx response", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >;
    };
    const offenders: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        // Skip non-operation keys like "parameters" that OpenAPI allows at path level.
        if (!op || typeof op !== "object" || !("responses" in op)) continue;
        const responses = op.responses ?? {};
        const has2xx = Object.keys(responses).some((s) => /^2\d\d$/.test(s));
        if (!has2xx) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("documents authorization failures for protected meta routes", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >;
    };

    expect(spec.paths["/api/meta/tables"].get.responses).toHaveProperty("403");
    expect(
      spec.paths["/api/meta/tables/{name}/indexes"].get.responses,
    ).toHaveProperty("403");
    expect(
      spec.paths["/api/meta/tables/{name}/sample"].get.responses,
    ).toHaveProperty("403");
    expect(spec.paths["/api/meta/sql"].post.responses).toHaveProperty("403");
  });

  it("omits contract routes with metadata.openapi.include false from OpenAPI only", async () => {
    const c = initContract();
    const publicRoute = c.query({
      method: "GET",
      path: "/public-status",
      summary: "Public status",
      responses: {
        200: z.object({ ok: z.boolean() }),
      },
    });
    const setupOnlyRoute = c.query({
      method: "GET",
      path: "/setup-status",
      summary: "Setup status",
      metadata: { openapi: { include: false } },
      responses: {
        200: z.object({ secret: z.string() }),
      },
    });

    const { app } = await createIntegrationApp({
      configureApi: (api) => {
        api.register("publicStatus", publicRoute, () => ({
          status: 200,
          body: { ok: true },
        }));
        api.register("setupStatus", setupOnlyRoute, () => ({
          status: 200,
          body: { secret: "setup-only" },
        }));
      },
    });

    const runtimeResponse = await app.request("/api/setup-status");
    expect(runtimeResponse.status).toBe(200);
    await expect(runtimeResponse.json()).resolves.toEqual({
      secret: "setup-only",
    });

    const specResponse = await app.request("/api/openapi.json");
    expect(specResponse.status).toBe(200);
    const spec = (await specResponse.json()) as {
      paths: Record<string, unknown>;
    };
    expect(spec.paths["/api/public-status"]).toBeDefined();
    expect(spec.paths["/api/setup-status"]).toBeUndefined();
  });

  it("omits registerFamily routes with metadata.openapi.include false", async () => {
    const c = initContract();
    const visibleFamilyRoute = c.query({
      method: "GET",
      path: "/family/visible",
      responses: {
        200: z.object({ name: z.string() }),
      },
    });
    const hiddenFamilyRoute = c.query({
      method: "GET",
      path: "/family/hidden",
      metadata: { openapi: { include: false } },
      responses: {
        200: z.object({ name: z.string() }),
      },
    });

    const { app } = await createIntegrationApp({
      configureApi: (api) => {
        api.registerFamily({
          method: "get",
          genericPath: "/family/:name",
          docs: () => ({
            visibleFamily: visibleFamilyRoute,
            hiddenFamily: hiddenFamilyRoute,
          }),
          dispatch: (context) => {
            const name = context.req.param("name");
            if (name === "hidden") {
              return {
                route: hiddenFamilyRoute,
                handler: () => ({ status: 200, body: { name } }),
              };
            }
            if (name === "visible") {
              return {
                route: visibleFamilyRoute,
                handler: () => ({ status: 200, body: { name } }),
              };
            }
            return undefined;
          },
        });
      },
    });

    const runtimeResponse = await app.request("/api/family/hidden");
    expect(runtimeResponse.status).toBe(200);
    await expect(runtimeResponse.json()).resolves.toEqual({ name: "hidden" });

    const specResponse = await app.request("/api/openapi.json");
    expect(specResponse.status).toBe(200);
    const spec = (await specResponse.json()) as {
      paths: Record<string, unknown>;
    };
    expect(spec.paths["/api/family/visible"]).toBeDefined();
    expect(spec.paths["/api/family/hidden"]).toBeUndefined();
  });

  it("serves app-owned report routes through the app API and OpenAPI", async () => {
    const c = initContract();
    const trialBalanceRoute = c.query({
      method: "GET",
      path: "/reports/trial-balance",
      summary: "Trial Balance",
      metadata: { tags: ["reports"] },
      query: z.object({ asOfDate: z.string() }),
      responses: {
        200: gridDatasetSchema,
      },
    });

    const { app } = await createIntegrationApp({
      configureApi: (api) => {
        api.register("trialBalanceReport", trialBalanceRoute, ({ request }) => {
          const result = {
            name: "trial-balance",
            label: "Trial Balance",
            rootLevel: "account",
            levels: {
              account: {
                columns: [
                  { id: "account", label: "Account", kind: "text" },
                  {
                    id: "asOfDate",
                    label: "As of Date",
                    kind: "date",
                    visuallyHidden: true,
                  },
                  {
                    id: "debit",
                    label: "Debit",
                    kind: "number",
                    displayFormat: "currency",
                    zeroDisplay: "blank",
                  },
                  {
                    id: "credit",
                    label: "Credit",
                    kind: "number",
                    displayFormat: "currency",
                    zeroDisplay: "blank",
                  },
                ],
                childLevels: [],
              },
            },
            nodes: [
              {
                rowKey: "cash",
                levelName: "account",
                columns: {
                  account: "Cash",
                  asOfDate: request.query.asOfDate,
                  debit: 125,
                  credit: 0,
                },
              },
            ],
            footerRows: [
              {
                rowKey: "grand-total",
                columns: { account: "Grand Total", debit: 125, credit: 0 },
              },
            ],
          } satisfies GridDataset;

          return { status: 200, body: result };
        });
      },
    });

    const specResponse = await app.request("/api/openapi.json");
    expect(specResponse.status).toBe(200);
    const spec = (await specResponse.json()) as {
      paths: Record<string, unknown>;
    };
    expect(spec.paths["/api/reports/trial-balance"]).toBeDefined();

    const reportResponse = await app.request(
      "/api/reports/trial-balance?asOfDate=2026-06-12",
    );
    expect(reportResponse.status).toBe(200);
    const body = gridDatasetSchema.parse(await reportResponse.json());
    expect(body).toMatchObject({
      name: "trial-balance",
      rootLevel: "account",
      nodes: [
        {
          rowKey: "cash",
          levelName: "account",
          columns: { account: "Cash", asOfDate: "2026-06-12" },
        },
      ],
    });
  });
});
