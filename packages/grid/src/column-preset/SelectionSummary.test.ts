import { describe, expect, it, vi } from "vitest";
import { makeRowId, rootPath } from "../grid/types/identity";
import type { LevelRow } from "../grid/types/level-row";
import { formatCurrency, formatNumber, formatPercentage } from "./format";
import { columnPreset } from "./columns";
import { selectionSumForColumn } from "./SelectionSummary";

const path = rootPath("rows");
const rows = [row("one", 1), row("two", null), row("three", 2.5)];

describe("ColumnPreset selection summary", () => {
  it("sums number, currency, and percentage columns with their formatters", () => {
    const cases = [
      {
        column: columnPreset.number({ id: "number", name: "Number" }),
        expected: formatNumber(3.5),
      },
      {
        column: columnPreset.currency({ id: "currency", name: "Currency" }),
        expected: formatCurrency(3.5),
      },
      {
        column: columnPreset.percentage({
          id: "percentage",
          name: "Percentage",
        }),
        expected: formatPercentage(3.5),
      },
    ];

    for (const current of cases) {
      expect(selectionSumForColumn(current.column, rows)).toBe(
        current.expected,
      );
    }
  });

  it("uses the column's resolved custom formatter", () => {
    const format = vi.fn((value: unknown) => `total:${String(value)}`);
    const column = columnPreset.number({
      id: "amount",
      name: "Amount",
      format,
    });

    expect(selectionSumForColumn(column, rows)).toBe("total:3.5");
    expect(format).toHaveBeenCalledWith(3.5);
  });

  it("does not summarize non-numeric preset kinds", () => {
    expect(
      selectionSumForColumn(
        columnPreset.text({ id: "amount", name: "Amount" }),
        rows,
      ),
    ).toBeNull();
  });

  it("uses the same finite numeric values as preset rendering", () => {
    const column = columnPreset.number({ id: "amount", name: "Amount" });

    expect(
      selectionSumForColumn(column, [
        row("null", null),
        row("text", "2"),
        row("nan", Number.NaN),
      ]),
    ).toBe(formatNumber(2));
  });
});

function row(rowKey: string, amount: unknown): LevelRow {
  const columns = {
    amount,
    number: amount,
    currency: amount,
    percentage: amount,
  };
  return {
    kind: "data",
    id: makeRowId(path, rowKey),
    rowSelectable: true,
    columns,
    hasChildren: false,
    source: { rowKey, levelName: "rows", columns },
  };
}
