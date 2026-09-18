/**
 * Integration tests for tree tables (`meta.tree`) over HTTP: the `tree` list
 * option, `fixed` conditions, `meta.tree` in the response, row scope, and the
 * table schema.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asAuth, createIntegrationApp, postJson, request } from "./setup.js";

type Row = { id: number; name: string; parent_id: number | null };

async function create(
  name: string,
  parentId: number | null = null,
  archived = false,
) {
  const res = await postJson("/api/tables/categories", {
    name,
    parent_id: parentId,
    archived,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: Row }).data.id;
}

async function list(query: string) {
  const res = await request(`/api/tables/categories?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    data: Row[];
    meta: {
      total: number;
      tree?: { matchCount: number; contextIds: string[] };
    };
  };
}

const ids: Record<string, number> = {};

beforeAll(async () => {
  await createIntegrationApp();
  // Expenses > Taxes > Federal > Payroll; Expenses > Rent; Income
  // Taxes > Old rates (archived) > Rates 2019
  ids.expenses = await create("Expenses");
  ids.taxes = await create("Taxes", ids.expenses);
  ids.federal = await create("Federal", ids.taxes);
  ids.payroll = await create("Payroll", ids.federal);
  ids.rent = await create("Rent", ids.expenses);
  ids.income = await create("Income");
  ids.oldRates = await create("Old rates", ids.taxes, true);
  ids.rates2019 = await create("Rates 2019", ids.oldRates);
  // Another user's category, which this user must never see.
  const other = asAuth({ userId: "user-2" });
  const res = await other.postJson("/api/tables/categories", {
    name: "Federal grants",
  });
  expect(res.status).toBe(201);
});

describe("tree tables over HTTP", () => {
  it("returns a search match with its ancestors and subtree", async () => {
    const body = await list(
      "q=federal&tree=ancestors-and-descendants&sort=id&limit=1000",
    );
    expect(body.data.map((row) => row.name)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Payroll",
    ]);
    expect(body.meta.total).toBe(4);
    expect(body.meta.tree).toEqual({
      matchCount: 1,
      contextIds: [String(ids.expenses), String(ids.taxes)],
    });
  });

  it("combines filters with search and keeps only ancestors on request", async () => {
    const body = await list(
      "filter[name][startswith]=Fed&tree=ancestors&sort=id",
    );
    expect(body.data.map((row) => row.name)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
    ]);
    expect(body.meta.tree?.matchCount).toBe(1);
  });

  it("leaves an unfiltered read unchanged", async () => {
    const body = await list("tree=ancestors-and-descendants");
    expect(body.meta.total).toBe(8);
    expect(body.meta.tree).toBeUndefined();
  });

  it("keeps a matched subtree inside the fixed conditions", async () => {
    const unfixed = await list(
      "q=taxes&tree=ancestors-and-descendants&sort=id",
    );
    expect(unfixed.data.map((row) => row.name)).toContain("Old rates");

    const body = await list(
      "fixed[archived][eq]=false&q=taxes&tree=ancestors-and-descendants&sort=id",
    );
    expect(body.data.map((row) => row.name)).toEqual([
      "Expenses",
      "Taxes",
      "Federal",
      "Payroll",
    ]);
    expect(body.meta.tree).toEqual({
      matchCount: 1,
      contextIds: [String(ids.expenses)],
    });
  });

  it("ends the ancestor walk at a row that fails the fixed conditions", async () => {
    const body = await list(
      "fixed[archived][eq]=false&q=2019&tree=ancestors&sort=id",
    );
    expect(body.data.map((row) => row.name)).toEqual(["Rates 2019"]);
    expect(body.meta.tree).toEqual({ matchCount: 1, contextIds: [] });
  });

  it("counts only matches that satisfy the fixed conditions", async () => {
    const body = await list(
      "fixed[archived][eq]=false&filter[name][contains]=rates&tree=ancestors",
    );
    expect(body.data.map((row) => row.name)).toEqual(["Rates 2019"]);
    expect(body.meta.tree?.matchCount).toBe(1);
  });

  it("returns every fixed row without a filter or search", async () => {
    const body = await list(
      `fixed[parent_id][eq]=${ids.taxes}&fixed[archived][eq]=false&tree=ancestors-and-descendants`,
    );
    expect(body.data.map((row) => row.name)).toEqual(["Federal"]);
    expect(body.meta.tree).toBeUndefined();
  });

  it("validates fixed conditions like filters, and only on list reads", async () => {
    const unknown = await request("/api/tables/categories?fixed[nope][eq]=1");
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).code).toBe("unknown_column");

    const shape = await request("/api/tables/categories?fixed[archived]=true");
    expect(shape.status).toBe(400);
    expect((await shape.json()).code).toBe("unknown_filter_shape");

    expect(
      (
        await request(
          "/api/tables/categories/export.csv?fixed[archived][eq]=false",
        )
      ).status,
    ).toBe(400);
  });

  it("keeps another user's rows out of the result", async () => {
    const body = await list("q=grants&tree=ancestors-and-descendants");
    expect(body.data).toEqual([]);
    expect(body.meta.tree).toEqual({ matchCount: 0, contextIds: [] });
  });

  it("rejects tree on a table without meta.tree", async () => {
    const res = await request("/api/tables/articles?tree=ancestors");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("no_tree_config");
  });

  it("rejects an unknown tree mode and tree on exports", async () => {
    expect((await request("/api/tables/categories?tree=subtree")).status).toBe(
      400,
    );
    expect(
      (await request("/api/tables/categories/export.csv?tree=ancestors"))
        .status,
    ).toBe(400);
  });

  it("publishes the tree declaration in the table schema", async () => {
    const res = await request("/api/meta/tables/categories");
    expect(res.status).toBe(200);
    const body = await res.json();
    const table = body.table ?? body;
    expect(table.tree).toEqual({
      parentColumn: "parent_id",
      column: "name",
      defaultExpanded: true,
      matchContext: "ancestors-and-descendants",
    });
  });

  it("documents the tree option in OpenAPI", async () => {
    const res = await request("/api/openapi.json");
    expect(res.status).toBe(200);
    const spec = JSON.stringify(await res.json());
    expect(spec).toContain("ancestors-and-descendants");
    expect(spec).toContain("contextIds");
  });
});
