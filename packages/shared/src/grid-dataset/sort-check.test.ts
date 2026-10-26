import { describe, expect, it } from "vitest";
import { gridDatasetSchema, type GridDatasetLevel } from "./result-schema.js";
import { gridDatasetSortProblems } from "./sort-check.js";

function ledgerLevel(level: Partial<GridDatasetLevel> = {}): GridDatasetLevel {
  return {
    columns: [
      { id: "date", label: "Date", kind: "date", sortBy: ["date", "sequence"] },
      { id: "amount", label: "Amount", kind: "number" },
      {
        id: "sequence",
        label: "Sequence",
        kind: "number",
        visuallyHidden: true,
      },
    ],
    childLevels: [],
    ...level,
  };
}

function dataset(level: GridDatasetLevel) {
  return gridDatasetSchema.parse({
    name: "ledger",
    label: "Ledger",
    rootLevel: "posting",
    levels: { posting: level },
    nodes: [],
  });
}

describe("gridDatasetSortProblems", () => {
  it("accepts sortBy columns the level has, hidden ones included", () => {
    expect(
      gridDatasetSortProblems(
        dataset(ledgerLevel({ sort: [{ column: "date", direction: "desc" }] })),
      ),
    ).toEqual([]);
  });

  it("names a sortBy entry the level lacks", () => {
    const level = ledgerLevel();
    level.columns[0] = { ...level.columns[0], sortBy: ["date", "seq"] };
    expect(gridDatasetSortProblems(dataset(level))).toEqual([
      'Dataset "ledger" level "posting" column "date" sorts by unknown column "seq".',
    ]);
  });

  it("rejects an empty sortBy", () => {
    const level = ledgerLevel();
    level.columns[0] = { ...level.columns[0], sortBy: [] };
    expect(() => dataset(level)).toThrow();
  });
});
