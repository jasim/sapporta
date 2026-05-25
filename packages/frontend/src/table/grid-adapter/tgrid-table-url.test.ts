import { describe, expect, test } from "vitest";
import {
  buildTableSearchParams,
  parseTableSearchParams,
} from "./tgrid-table-url";
import type { ColId } from "@sapporta/grid";

const COLS: ReadonlySet<ColId> = new Set(["name", "created_at"] as ColId[]);

describe("parseTableSearchParams - sort", () => {
  test("no sort key -> undefined (URL silent)", () => {
    const r = parseTableSearchParams(new URLSearchParams(""), COLS);
    expect(r.sort).toBeUndefined();
  });

  test("unrelated params, no sort key -> undefined", () => {
    const r = parseTableSearchParams(new URLSearchParams("page=2"), COLS);
    expect(r.sort).toBeUndefined();
  });

  test("empty sort key (`?sort=`) -> [] (explicit none)", () => {
    const r = parseTableSearchParams(new URLSearchParams("sort="), COLS);
    expect(r.sort).toEqual([]);
  });

  test("single asc colId", () => {
    const r = parseTableSearchParams(new URLSearchParams("sort=name"), COLS);
    expect(r.sort).toEqual([{ colId: "name", direction: "asc" }]);
  });

  test("signed comma list", () => {
    const r = parseTableSearchParams(
      new URLSearchParams("sort=name,-created_at"),
      COLS,
    );
    expect(r.sort).toEqual([
      { colId: "name", direction: "asc" },
      { colId: "created_at", direction: "desc" },
    ]);
  });

  test("unknown column id throws verbatim", () => {
    expect(() =>
      parseTableSearchParams(new URLSearchParams("sort=bogus"), COLS),
    ).toThrow(/unknown column id 'bogus'/);
  });

  test("duplicate column id throws", () => {
    expect(() =>
      parseTableSearchParams(new URLSearchParams("sort=name,-name"), COLS),
    ).toThrow(/duplicate column id 'name'/);
  });

  test("bare `-` is malformed and throws", () => {
    expect(() =>
      parseTableSearchParams(new URLSearchParams("sort=-"), COLS),
    ).toThrow(/malformed entry/);
  });

  test("empty entries between commas are tolerated", () => {
    const r = parseTableSearchParams(
      new URLSearchParams("sort=name,,-created_at"),
      COLS,
    );
    expect(r.sort).toEqual([
      { colId: "name", direction: "asc" },
      { colId: "created_at", direction: "desc" },
    ]);
  });
});

describe("buildTableSearchParams - sort", () => {
  test("undefined sort -> no sort key", () => {
    const sp = buildTableSearchParams({
      page: 1,
      sort: undefined,
      filters: [],
      search: null,
    });
    expect(sp.has("sort")).toBe(false);
  });

  test("empty sort -> no sort key (persisted stays authoritative on share)", () => {
    const sp = buildTableSearchParams({
      page: 1,
      sort: [],
      filters: [],
      search: null,
    });
    expect(sp.has("sort")).toBe(false);
  });

  test("non-empty sort -> signed comma list", () => {
    const sp = buildTableSearchParams({
      page: 1,
      sort: [
        { colId: "name" as ColId, direction: "asc" },
        { colId: "created_at" as ColId, direction: "desc" },
      ],
      filters: [],
      search: null,
    });
    expect(sp.get("sort")).toBe("name,-created_at");
  });
});
