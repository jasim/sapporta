import { describe, expect, it } from "vitest";
import {
  appendQueryParam,
  queryParamRecordToSearchParams,
  type QueryParamRecord,
} from "./query-params.js";

describe("lossless query parameter records", () => {
  it("keeps singleton keys ergonomic and accumulates repeated keys in order", () => {
    const query: QueryParamRecord = {};

    appendQueryParam(query, "page", "2");
    appendQueryParam(query, "filter[name][contains]", "left");
    appendQueryParam(query, "filter[name][contains]", "right");

    expect(query).toEqual({
      page: "2",
      "filter[name][contains]": ["left", "right"],
    });
  });

  it("serializes arrays as repeated keys rather than indexed key variants", () => {
    const params = queryParamRecordToSearchParams({
      page: "2",
      "filter[name][contains]": ["left", "right"],
    });

    expect(params.get("page")).toBe("2");
    expect(params.getAll("filter[name][contains]")).toEqual(["left", "right"]);
    expect(params.has("filter[name][contains][0]")).toBe(false);
  });
});
