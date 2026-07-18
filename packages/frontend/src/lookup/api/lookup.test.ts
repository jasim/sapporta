import { describe, expect, it } from "vitest";
import {
  buildLookupSearchQuery,
  buildLookupValueQuery,
  lookupEntriesFromResponse,
} from "./lookup";

describe("lookup API query serialization", () => {
  it("serializes typed lookup values only at the HTTP query boundary", () => {
    expect(buildLookupValueQuery([1, "1", 2])).toEqual({ ids: "1,1,2" });
  });

  it("omits ids when there are no values to request", () => {
    expect(buildLookupValueQuery([])).toEqual({});
  });

  it("sends only the fields displayed by the picker", () => {
    expect(
      buildLookupSearchQuery("alice", 25, ["name", "email", "name"]),
    ).toEqual({ q: "alice", limit: "25", fields: "name,email" });
    expect(buildLookupSearchQuery("alice")).toEqual({ q: "alice" });
  });

  it("preserves source-row metadata from lookup responses", () => {
    expect(
      lookupEntriesFromResponse({
        entries: [
          {
            value: 7,
            label: "Alice Adams",
            meta: { id: 7, name: "Alice Adams", email: "alice@example.com" },
          },
        ],
      }),
    ).toEqual([
      {
        value: 7,
        label: "Alice Adams",
        meta: { id: 7, name: "Alice Adams", email: "alice@example.com" },
      },
    ]);
  });
});
