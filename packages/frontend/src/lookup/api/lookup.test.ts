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
});
