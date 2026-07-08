import { describe, expect, it } from "vitest";
import type { SortDescriptor } from "@sapporta/grid";
import {
  parseFiltersForTable,
  type FilterCondition,
} from "@sapporta/shared/filter";
import {
  tableGridUrlForQueryState,
  tableQuerySeedFromUrlState,
} from "./table-grid-url-state";

const filterTable = {
  columns: [{ name: "status", kind: "text" as const }],
};

function typedFilters(filters: readonly FilterCondition[]) {
  return parseFiltersForTable(filters, filterTable);
}

describe("tableGridUrlForQueryState", () => {
  it("builds route-owned page links from query state", () => {
    const state = {
      sort: [
        { colId: "customer", direction: "asc" },
      ] satisfies SortDescriptor[],
      filters: typedFilters([
        { id: "status-open", column: "status", op: "eq", value: "open" },
      ]),
      search: "acme",
    };

    expect(tableGridUrlForQueryState("/orders", 3, state)).toBe(
      "/orders?filter%5Bstatus%5D%5Beq%5D=open&page=3&sort=customer&q=acme",
    );
    expect(tableGridUrlForQueryState("/orders", 1, state)).toBe(
      "/orders?filter%5Bstatus%5D%5Beq%5D=open&sort=customer&q=acme",
    );
  });
});

describe("tableQuerySeedFromUrlState", () => {
  it("omits absent URL values so level defaults can apply", () => {
    expect(
      tableQuerySeedFromUrlState({
        searchParams: new URLSearchParams(""),
        parsed: {
          page: 1,
          filters: [],
          search: null,
        },
        sort: undefined,
      }),
    ).toEqual({});
  });

  it("includes only values supplied by URL state or saved sort", () => {
    const filters = typedFilters([
      { id: "status-open", column: "status", op: "eq", value: "open" },
    ]);
    const sort = [
      { colId: "customer", direction: "asc" },
    ] satisfies SortDescriptor[];

    expect(
      tableQuerySeedFromUrlState({
        searchParams: new URLSearchParams(
          "page=3&filter%5Bstatus%5D%5Beq%5D=open&q=acme",
        ),
        parsed: {
          page: 3,
          filters,
          search: "acme",
        },
        sort,
      }),
    ).toEqual({
      page: 3,
      filters,
      search: "acme",
      sort,
    });
  });
});
