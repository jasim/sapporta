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
    // with a real row schema on create. The create body is emitted as a
    // union (row | array<row> | master-with-$details) whose branches are
    // registered as `$ref` components via `.meta({ id })`. Follow the
    // first `$ref` back to the components dictionary to find the row
    // schema and assert its `name` column survived specialization.
    const fullSpec = spec as unknown as {
      paths: Record<string, any>;
      components?: { schemas?: Record<string, any> };
    };
    expect(fullSpec.paths["/api/tables/accounts"]).toBeDefined();
    const post = fullSpec.paths["/api/tables/accounts"].post;
    const schema = post.requestBody.content["application/json"].schema;
    const branches = schema.anyOf ?? schema.oneOf ?? [schema];

    // Zod-v4's `toJSONSchema` emits a per-schema `definitions` dictionary
    // alongside the wrapper (rather than promoting to the spec-level
    // `components.schemas`). The test just cares that per-table columns
    // survived; follow refs into either location.
    const defs = schema.definitions ?? {};
    const resolveBranch = (b: any): any => {
      if (!b?.$ref) return b;
      const ref = String(b.$ref);
      if (ref.startsWith("#/definitions/")) {
        return defs[ref.slice("#/definitions/".length)];
      }
      if (ref.startsWith("#/components/schemas/")) {
        return fullSpec.components?.schemas?.[
          ref.slice("#/components/schemas/".length)
        ];
      }
      return b;
    };

    const objectBranch = branches
      .map(resolveBranch)
      .find((b: any) => b?.type === "object" && b.properties);
    expect(objectBranch).toBeDefined();
    expect(objectBranch.properties?.name).toBeDefined();
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
