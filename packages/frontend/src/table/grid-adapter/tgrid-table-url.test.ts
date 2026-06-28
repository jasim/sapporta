import { describe, expect, test } from "vitest";
import {
  buildTableSearchParams,
  parseTableSearchParams,
  relatedRowsTableHref,
  sanitizeSortDescriptors,
} from "./tgrid-table-url";
import type { ColId } from "@sapporta/grid";
import type { ColumnSchema } from "@sapporta/shared/contracts";

const COLS: ReadonlySet<ColId> = new Set(["name", "created_at"] as ColId[]);
const FILTER_COLS: ReadonlySet<ColId> = new Set([
  "book_id",
  "title",
] as ColId[]);
const FILTER_COLUMNS: ColumnSchema[] = [
  {
    name: "book_id",
    label: "Book",
    kind: "number",
    foreignKey: { table: "books", column: "id" },
  },
  { name: "title", label: "Title", kind: "text" },
];

describe("parseTableSearchParams - page", () => {
  test("defaults to page 1 when absent", () => {
    const r = parseTableSearchParams(new URLSearchParams(""), COLS);
    expect(r.page).toBe(1);
  });

  test("parses canonical positive integer pages", () => {
    const r = parseTableSearchParams(new URLSearchParams("page=12"), COLS);
    expect(r.page).toBe(12);
  });

  test("falls back to page 1 for malformed pages", () => {
    for (const query of ["page=0", "page=01", "page=12abc", "page=1.5"]) {
      const r = parseTableSearchParams(new URLSearchParams(query), COLS);
      expect(r.page).toBe(1);
    }
  });
});

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

describe("parseTableSearchParams - filters", () => {
  test("canonicalizes foreign-key equality to single-value membership", () => {
    const r = parseTableSearchParams(
      new URLSearchParams("filter%5Bbook_id%5D%5Beq%5D=6"),
      FILTER_COLS,
      FILTER_COLUMNS,
    );

    expect(r.filters).toHaveLength(1);
    expect(r.filters[0]).toMatchObject({
      column: "book_id",
      op: "in",
      values: ["6"],
    });
  });

  test("canonicalizes foreign-key inequality to single-value exclusion", () => {
    const r = parseTableSearchParams(
      new URLSearchParams("filter%5Bbook_id%5D%5Bneq%5D=6"),
      FILTER_COLS,
      FILTER_COLUMNS,
    );

    expect(r.filters).toHaveLength(1);
    expect(r.filters[0]).toMatchObject({
      column: "book_id",
      op: "nin",
      values: ["6"],
    });
  });

  test("leaves non-foreign-key equality as scalar equality", () => {
    const r = parseTableSearchParams(
      new URLSearchParams("filter%5Btitle%5D%5Beq%5D=Draft"),
      FILTER_COLS,
      FILTER_COLUMNS,
    );

    expect(r.filters).toHaveLength(1);
    expect(r.filters[0]).toMatchObject({
      column: "title",
      op: "eq",
      value: "Draft",
    });
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

describe("relatedRowsTableHref", () => {
  test("builds the default table route with a parent foreign-key filter", () => {
    expect(
      relatedRowsTableHref({
        tableName: "order_lines",
        foreignKey: "order_id",
        parentRowId: "1001",
      }),
    ).toBe("/tables/order_lines?filter%5Border_id%5D%5Beq%5D=1001");
  });

  test("uses a custom route path with the same filter encoding", () => {
    expect(
      relatedRowsTableHref({
        tableName: "order_lines",
        foreignKey: "order_id",
        parentRowId: "A&B",
        routePath: "/orders/lines",
      }),
    ).toBe("/orders/lines?filter%5Border_id%5D%5Beq%5D=A%26B");
  });
});

describe("sanitizeSortDescriptors", () => {
  test("keeps valid persisted sort descriptors", () => {
    expect(
      sanitizeSortDescriptors(
        [
          { colId: "name", direction: "asc" },
          { colId: "created_at", direction: "desc" },
        ],
        COLS,
      ),
    ).toEqual([
      { colId: "name", direction: "asc" },
      { colId: "created_at", direction: "desc" },
    ]);
  });

  test("drops stale, malformed, and duplicate persisted sort descriptors", () => {
    expect(
      sanitizeSortDescriptors(
        [
          { colId: "kind", direction: "asc" },
          { colId: "name", direction: "sideways" },
          null,
          "name",
          { colId: "name", direction: "asc" },
          { colId: "name", direction: "desc" },
        ],
        COLS,
      ),
    ).toEqual([{ colId: "name", direction: "asc" }]);
  });
});
