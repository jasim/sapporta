import { describe, expect, it } from "vitest";
import { eqCondition, parseFiltersForTable } from "@sapporta/shared/filter";
import { buildTableRowsQuery } from "./rows";

const table = {
  columns: [
    { name: "name", kind: "text" as const },
    { name: "archived", kind: "boolean" as const },
  ],
};

describe("buildTableRowsQuery", () => {
  it("sends the fixed conditions apart from the user's filters and search", () => {
    const [archived] = parseFiltersForTable(
      [eqCondition("archived", "false")],
      table,
    );
    const [name] = parseFiltersForTable([eqCondition("name", "Taxes")], table);
    expect(
      buildTableRowsQuery({
        fixed: [archived],
        filters: [name],
        search: "tax",
        tree: "ancestors",
        page: 1,
        limit: 1000,
      }),
    ).toEqual({
      "fixed[archived][eq]": "false",
      "filter[name][eq]": "Taxes",
      q: "tax",
      tree: "ancestors",
      page: "1",
      limit: "1000",
    });
  });
});
