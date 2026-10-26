import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "../../types/schema";
import type { SortDescriptor } from "../types";
import { makeRowComparator } from "./sort-impl";

const textCompare = (a: unknown, b: unknown) =>
  String(a).localeCompare(String(b));
const numberCompare = (a: unknown, b: unknown) => Number(a) - Number(b);

function column(id: string, extra: Partial<ColumnSchema> = {}): ColumnSchema {
  return { id, name: id, renderCell: () => null, ...extra };
}

// Two postings on 04-04 tie on date. `seq` holds their order in time; the
// rows arrive newest first.
const rows = [
  { key: "cabs", date: "2026-04-04", seq: 3, amount: 70 },
  { key: "groceries", date: "2026-04-04", seq: 2, amount: 430 },
  { key: "donations", date: "2026-04-02", seq: 1, amount: 500 },
];

function sorted(
  columns: readonly ColumnSchema[],
  sort: readonly SortDescriptor[],
): string[] {
  const compare = makeRowComparator(sort, columns);
  return [...rows].sort(compare).map((row) => row.key);
}

describe("makeRowComparator", () => {
  it("orders by the column's own value and keeps ties in source order", () => {
    const columns = [column("date", { compare: textCompare })];
    expect(sorted(columns, [{ colId: "date", direction: "asc" }])).toEqual([
      "donations",
      "cabs",
      "groceries",
    ]);
  });

  it("orders by every sort key, each in the sort's direction", () => {
    const columns = [
      column("date", {
        compare: textCompare,
        sortKeys: [
          { field: "date", compare: textCompare },
          { field: "seq", compare: numberCompare },
        ],
      }),
    ];
    expect(sorted(columns, [{ colId: "date", direction: "asc" }])).toEqual([
      "donations",
      "groceries",
      "cabs",
    ]);
    expect(sorted(columns, [{ colId: "date", direction: "desc" }])).toEqual([
      "cabs",
      "groceries",
      "donations",
    ]);
  });

  it("compares each sort key with its own comparison", () => {
    // Text comparison would put "10" before "9".
    const ten = [
      { key: "nine", seq: 9 },
      { key: "ten", seq: 10 },
    ];
    const columns = [
      column("date", {
        compare: textCompare,
        sortKeys: [{ field: "seq", compare: numberCompare }],
      }),
    ];
    const compare = makeRowComparator(
      [{ colId: "date", direction: "asc" }],
      columns,
    );
    expect([...ten].sort(compare).map((row) => row.key)).toEqual([
      "nine",
      "ten",
    ]);
  });

  it("throws on a column the level lacks, naming the level's columns", () => {
    const columns = [column("date", { compare: textCompare })];
    expect(() =>
      makeRowComparator([{ colId: "missing", direction: "asc" }], columns),
    ).toThrow(
      'sort names column "missing", which is not a column of the level (columns: date)',
    );
  });

  it("throws on a column without a comparison or sort keys", () => {
    const columns = [column("date")];
    expect(() =>
      makeRowComparator([{ colId: "date", direction: "asc" }], columns),
    ).toThrow('sort names column "date", which has no compare and no sortKeys');
  });

  it("throws on a column with empty sort keys", () => {
    const columns = [column("date", { compare: textCompare, sortKeys: [] })];
    expect(() =>
      makeRowComparator([{ colId: "date", direction: "asc" }], columns),
    ).toThrow('sort names column "date", which has no compare and no sortKeys');
  });
});
