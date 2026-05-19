/**
 * Integration tests for the /api/reports namespace (single-project mode).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createIntegrationApp, request, postJson } from "./setup.js";

beforeAll(async () => {
  await createIntegrationApp();

  // Seed accounts data for report tests.
  await postJson("/api/tables/accounts", { name: "Cash", type: "asset", balance: 10000 });
  await postJson("/api/tables/accounts", { name: "Revenue", type: "revenue", balance: 5000 });
  await postJson("/api/tables/accounts", { name: "Equipment", type: "asset", balance: 25000 });
});

describe("/api/reports", () => {
  it("GET /api/reports lists reports with name, label, params", async () => {
    const res = await request("/api/reports");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.reports).toHaveLength(1);

    const report = body.reports[0];
    expect(report.name).toBe("account-list");
    expect(report.label).toBe("Account List");
    expect(report.params).toHaveLength(1);
    expect(report.params[0].name).toBe("type");
    expect(report.params[0].required).toBe(false);
  });

  it("GET /api/reports/account-list returns metadata with columns", async () => {
    const res = await request("/api/reports/account-list");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("account-list");
    expect(body.label).toBe("Account List");
    expect(body.columns).toHaveLength(3);

    const colNames = body.columns.map((c: any) => c.name);
    expect(colNames).toEqual(["name", "type", "balance"]);
  });

  it("GET /api/reports/nonexistent returns 404", async () => {
    const res = await request("/api/reports/nonexistent");
    expect(res.status).toBe(404);
  });

  it("GET /api/reports/account-list/results executes the report", async () => {
    const res = await request("/api/reports/account-list/results");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data).toHaveLength(3);

    const first = body.data[0];
    expect(first.levelName).toBe("account");
    expect(first.columns).toBeDefined();
    expect(first.columns).toHaveProperty("name");
    expect(first.columns).toHaveProperty("type");
    expect(first.columns).toHaveProperty("balance");
  });

  it("GET /api/reports/account-list/results?type=asset returns filtered results", async () => {
    const res = await request("/api/reports/account-list/results?type=asset");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data).toHaveLength(2);
    for (const node of body.data) {
      expect(node.columns.type).toBe("asset");
    }
  });
});
