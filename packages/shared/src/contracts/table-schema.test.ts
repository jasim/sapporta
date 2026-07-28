import { describe, expect, it } from "vitest";
import { countQuerySchema, listRowsQuerySchema } from "./table-schema.js";

describe("table query contracts", () => {
  it("keeps singleton fields as scalars and repeated filters as arrays", () => {
    expect(
      listRowsQuerySchema.parse({
        page: "2",
        limit: "25",
        sort: "name",
        q: "needle",
        "filter[name][contains]": ["left", "right"],
      }),
    ).toEqual({
      page: "2",
      limit: "25",
      sort: "name",
      q: "needle",
      "filter[name][contains]": ["left", "right"],
    });
  });

  it("keeps count fields ergonomic alongside repeated filters", () => {
    expect(
      countQuerySchema.parse({
        group_by: "status",
        order: "asc",
        limit: "10",
        "filter[name][contains]": ["left", "right"],
      }),
    ).toEqual({
      group_by: "status",
      order: "asc",
      limit: 10,
      "filter[name][contains]": ["left", "right"],
    });
  });

  it("rejects repeated singleton fields", () => {
    expect(() => listRowsQuerySchema.parse({ page: ["1", "2"] })).toThrow();
  });
});
