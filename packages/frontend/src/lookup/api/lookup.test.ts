import { describe, expect, it } from "vitest";
import { buildLookupValueQuery } from "./lookup";

describe("lookup API query serialization", () => {
  it("serializes typed lookup values only at the HTTP query boundary", () => {
    expect(buildLookupValueQuery([1, "1", 2])).toEqual({ ids: "1,1,2" });
  });

  it("omits ids when there are no values to request", () => {
    expect(buildLookupValueQuery([])).toEqual({});
  });
});
