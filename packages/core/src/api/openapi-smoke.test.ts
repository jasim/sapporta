/**
 * Smoke test for IMPL-3: verify the ported built-in sub-apps are fully
 * registered in the served `/openapi.json`. This is the thin safety net
 * for the port — it catches a half-finished port that ships green because
 * no other test happens to inspect the generated spec.
 *
 * Scope deliberately narrow:
 *  - built-in paths present (/api/meta/tables, /api/meta/sql, /api/reports)
 *  - every operation has ≥1 2xx response entry
 *
 * We do NOT assert anything about /api/tables/{tableName} or /api/reports/{name}/results
 * here — those are registered generically in IMPL-3 and specialized in IMPL-4,
 * so pinning their presence would couple these two stages' tests.
 */
import { describe, it, expect } from "vitest";
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
    expect(spec.paths["/api/reports"]).toBeDefined();
  });

  it("specializes dynamic /tables and /reports templates (IMPL-4)", async () => {
    const app = await createServedApp();
    const res = await app.request("/api/openapi.json");
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, any>>;
    };

    // The loose templates must not survive into the served document.
    expect(spec.paths["/api/tables/{tableName}"]).toBeUndefined();
    expect(spec.paths["/api/reports/{name}/results"]).toBeUndefined();

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
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
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
});
