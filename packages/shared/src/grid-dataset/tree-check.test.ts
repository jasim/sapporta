import { describe, expect, it } from "vitest";
import { gridDatasetSchema, type GridDatasetLevel } from "./result-schema.js";
import {
  gridDatasetTreeColumn,
  gridDatasetTreeProblems,
} from "./tree-check.js";

function accountLevel(level: Partial<GridDatasetLevel> = {}): GridDatasetLevel {
  return {
    columns: [
      {
        id: "parent_id",
        label: "Parent",
        kind: "text",
        visuallyHidden: true,
      },
      { id: "code", label: "Code", kind: "number" },
      { id: "name", label: "Account", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" },
    ],
    childLevels: [],
    tree: { parentColumn: "parent_id" },
    ...level,
  };
}

function dataset(level: GridDatasetLevel) {
  return gridDatasetSchema.parse({
    name: "expenses",
    label: "Expenses",
    rootLevel: "account",
    levels: { account: level },
    nodes: [
      {
        rowKey: "1",
        levelName: "account",
        columns: { parent_id: null, code: 5000, name: "Expenses", amount: 300 },
      },
      {
        rowKey: "2",
        levelName: "account",
        columns: { parent_id: "1", code: 5100, name: "Rent", amount: 300 },
      },
    ],
  });
}

describe("gridDatasetLevelSchema tree", () => {
  it("keeps a level's tree declaration", () => {
    const parsed = dataset(
      accountLevel({ tree: { parentColumn: "parent_id", column: "name" } }),
    );
    expect(parsed.levels.account.tree).toEqual({
      parentColumn: "parent_id",
      column: "name",
    });
  });

  it("requires a parent column", () => {
    expect(() =>
      gridDatasetSchema.parse({
        name: "expenses",
        label: "Expenses",
        rootLevel: "account",
        levels: { account: { ...accountLevel(), tree: { column: "name" } } },
        nodes: [],
      }),
    ).toThrow();
  });
});

describe("gridDatasetTreeColumn", () => {
  it("defaults to the first visible text column", () => {
    expect(gridDatasetTreeColumn(accountLevel())).toBe("name");
  });

  it("falls back to the first visible column without a text column", () => {
    const level = accountLevel({
      columns: [
        {
          id: "parent_id",
          label: "Parent",
          kind: "text",
          visuallyHidden: true,
        },
        { id: "code", label: "Code", kind: "number" },
      ],
    });
    expect(gridDatasetTreeColumn(level)).toBe("code");
  });

  it("uses the declared column", () => {
    const level = accountLevel({
      tree: { parentColumn: "parent_id", column: "code" },
    });
    expect(gridDatasetTreeColumn(level)).toBe("code");
  });

  it("is null for a level without a tree", () => {
    expect(gridDatasetTreeColumn(accountLevel({ tree: undefined }))).toBeNull();
  });
});

describe("gridDatasetTreeProblems", () => {
  it("accepts a tree whose parent column is a hidden column of the level", () => {
    expect(gridDatasetTreeProblems(dataset(accountLevel()))).toEqual([]);
  });

  it("ignores levels without a tree", () => {
    const level = accountLevel({ tree: undefined, childLevels: ["entry"] });
    expect(gridDatasetTreeProblems(dataset(level))).toEqual([]);
  });

  it("reports a parent column the level does not have", () => {
    const level = accountLevel({ tree: { parentColumn: "parent" } });
    expect(gridDatasetTreeProblems(dataset(level))).toEqual([
      'Dataset "expenses" tree level "account" names unknown parent column ' +
        '"parent".',
    ]);
  });

  it("reports a tree column that is hidden or missing", () => {
    for (const column of ["parent_id", "missing"]) {
      const level = accountLevel({
        tree: { parentColumn: "parent_id", column },
      });
      expect(gridDatasetTreeProblems(dataset(level))).toEqual([
        `Dataset "expenses" tree level "account" names tree column ` +
          `"${column}", which is not a visible column of the level.`,
      ]);
    }
  });

  it("reports a tree level with no visible column", () => {
    const level = accountLevel({
      columns: [
        {
          id: "parent_id",
          label: "Parent",
          kind: "text",
          visuallyHidden: true,
        },
      ],
    });
    expect(gridDatasetTreeProblems(dataset(level))).toEqual([
      'Dataset "expenses" tree level "account" has no visible column to ' +
        "show the tree.",
    ]);
  });
});
