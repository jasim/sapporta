import { describe, expect, expectTypeOf, it } from "vitest";
import type { ClientInferRequest } from "@sapporta/rest-core";
import type { QueryParamValue } from "../query-params.js";
import {
  countQuerySchema,
  DEFAULT_LOOKUP_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  lookupQuerySchema,
  MAX_LOOKUP_IDS,
  MAX_LOOKUP_LIMIT,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  listRowsQuerySchema,
  type ListRowsQuery,
} from "./table-schema.js";
import { listRowsRoute } from "./table-routes.js";

describe("table query contracts", () => {
  it("coerces and defaults bounded pagination while preserving filters", () => {
    expect(
      listRowsQuerySchema.parse({
        page: "2",
        limit: "25",
        sort: "name",
        q: "needle",
        "filter[name][contains]": ["left", "right"],
      }),
    ).toEqual({
      page: 2,
      limit: 25,
      sort: "name",
      q: "needle",
      "filter[name][contains]": ["left", "right"],
    });
    expect(listRowsQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      limit: DEFAULT_PAGE_SIZE,
    });

    const output: ListRowsQuery = listRowsQuerySchema.parse({
      "filter[name][contains]": ["left", "right"],
    });
    expectTypeOf(output.page).toEqualTypeOf<number>();
    expectTypeOf(output.limit).toEqualTypeOf<number>();
    expectTypeOf(
      output["filter[name][contains]"],
    ).toEqualTypeOf<QueryParamValue>();
  });

  it("keeps generated client pagination inputs in the string wire shape", () => {
    type ListRowsClientQuery = ClientInferRequest<
      typeof listRowsRoute
    >["query"];

    const query = {
      page: "2",
      limit: "25",
      "filter[name][contains]": ["left", "right"],
    } satisfies ListRowsClientQuery;

    expect(query).toEqual({
      page: "2",
      limit: "25",
      "filter[name][contains]": ["left", "right"],
    });
    expectTypeOf<ListRowsClientQuery["page"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<ListRowsClientQuery["limit"]>().toEqualTypeOf<
      string | undefined
    >();

    if (false) {
      const numericPage = {
        // @ts-expect-error HTTP query inputs use strings before Zod coercion.
        page: 2,
      } satisfies ListRowsClientQuery;
      void numericPage;
    }
  });

  it("rejects pagination values outside the static bounds", () => {
    for (const query of [
      { page: "0" },
      { page: String(MAX_PAGE + 1) },
      { page: "not-a-number" },
      { limit: "0" },
      { limit: String(MAX_PAGE_SIZE + 1) },
      { limit: "not-a-number" },
    ]) {
      expect(() => listRowsQuerySchema.parse(query)).toThrow();
    }
  });

  it("parses lookup ID and search modes into distinct output shapes", () => {
    expect(lookupQuerySchema.parse({ ids: "1, 2" })).toEqual({
      ids: ["1", "2"],
    });
    expect(
      lookupQuerySchema.parse({
        q: "alice",
        fields: "name,email",
        limit: "25",
      }),
    ).toEqual({
      q: "alice",
      fields: "name,email",
      limit: 25,
    });
    expect(lookupQuerySchema.parse({})).toEqual({
      limit: DEFAULT_LOOKUP_LIMIT,
    });
  });

  it("rejects contradictory lookup modes", () => {
    for (const query of [
      { ids: "1", q: "alice" },
      { ids: "1", fields: "name" },
      { ids: "1", limit: "1" },
    ]) {
      expect(() => lookupQuerySchema.parse(query)).toThrow();
    }
  });

  it("bounds lookup IDs separately from search results", () => {
    const maximumIds = Array.from(
      { length: MAX_LOOKUP_IDS },
      (_, index) => index + 1,
    ).join(",");
    const tooManyIds = `${maximumIds},${MAX_LOOKUP_IDS + 1}`;

    expect(lookupQuerySchema.parse({ ids: maximumIds })).toEqual({
      ids: maximumIds.split(","),
    });
    expect(() => lookupQuerySchema.parse({ ids: tooManyIds })).toThrow();
    for (const ids of ["", ",,,", "1,,2", "1, ,2"]) {
      expect(() => lookupQuerySchema.parse({ ids })).toThrow();
    }
    expect(
      lookupQuerySchema.parse({ limit: String(MAX_LOOKUP_LIMIT) }),
    ).toEqual({
      limit: MAX_LOOKUP_LIMIT,
    });
    expect(() =>
      lookupQuerySchema.parse({ limit: String(MAX_LOOKUP_LIMIT + 1) }),
    ).toThrow();
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
