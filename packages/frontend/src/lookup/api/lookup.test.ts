import { describe, expect, it } from "vitest";
import {
  buildLookupSearchQuery,
  buildLookupValueQuery,
  lookupEntriesFromResponse,
  lookupNarrowingQuery,
} from "./lookup";

describe("lookup API query serialization", () => {
  it("serializes typed lookup values only at the HTTP query boundary", () => {
    expect(buildLookupValueQuery([1, "1", 2])).toEqual({ ids: "1,1,2" });
  });

  it("does not serialize an empty ID lookup mode", () => {
    expect(() => buildLookupValueQuery([])).toThrow(
      "A value lookup requires at least one ID.",
    );
  });

  it("serializes search without ID-mode parameters", () => {
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

  it("serializes a narrowing in the list filter grammar", () => {
    expect(
      lookupNarrowingQuery({
        filter: [
          { column: "account_type", op: "in", values: ["asset", "liability"] },
          { column: "name", op: "contains", value: "a" },
          { column: "name", op: "contains", value: "b" },
          { column: "closed_on", op: "is", polarity: "null" },
        ],
        notUnder: 4,
      }),
    ).toEqual({
      "filter[account_type][in]": "asset,liability",
      "filter[name][contains]": ["a", "b"],
      "filter[closed_on][is]": "null",
      notUnder: "4",
    });
    expect(lookupNarrowingQuery(undefined)).toEqual({});
  });
});
