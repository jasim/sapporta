import { describe, expect, it } from "vitest";
import {
  gridDatasetReferenceIds,
  gridDatasetReferenceProblems,
} from "./reference-check.js";
import { gridDatasetSchema, type GridDataset } from "./result-schema.js";

function ledger(): GridDataset {
  return {
    name: "ledger",
    label: "Ledger",
    rootLevel: "groups",
    levels: {
      groups: {
        columns: [
          { id: "group_id", label: "ID", kind: "number", visuallyHidden: true },
          {
            id: "group",
            label: "Group",
            kind: "text",
            reference: { table: "accounts", idColumn: "group_id" },
          },
        ],
        childLevels: ["lines"],
      },
      lines: {
        columns: [
          {
            id: "account_id",
            label: "ID",
            kind: "number",
            visuallyHidden: true,
          },
          {
            id: "account",
            label: "Account",
            kind: "text",
            reference: { table: "accounts", idColumn: "account_id" },
          },
          { id: "item_id", label: "ID", kind: "text", visuallyHidden: true },
          {
            id: "item",
            label: "Item",
            kind: "text",
            reference: { table: "items", idColumn: "item_id" },
          },
        ],
        childLevels: [],
      },
    },
    nodes: [
      {
        rowKey: "g1",
        levelName: "groups",
        columns: { group_id: 1, group: "Assets" },
        children: {
          lines: [
            {
              rowKey: "l1",
              levelName: "lines",
              columns: { account_id: 2, account: "Cash", item_id: "a" },
            },
            {
              rowKey: "l2",
              levelName: "lines",
              columns: { account_id: 1, account: "Assets", item_id: "" },
            },
          ],
        },
        childFooterRows: {
          lines: [{ rowKey: "f", columns: { account_id: 3, item_id: null } }],
        },
      },
    ],
    footerRows: [{ rowKey: "total", columns: { group_id: 4 } }],
    computed: { accounts: { parentPath: { "1": null, "2": "Assets" } } },
  };
}

describe("grid dataset references", () => {
  it("accepts reference columns and computed values", () => {
    const parsed = gridDatasetSchema.parse(ledger());
    expect(parsed.levels.lines!.columns[1]!.reference).toEqual({
      table: "accounts",
      idColumn: "account_id",
    });
    expect(parsed.computed).toEqual({
      accounts: { parentPath: { "1": null, "2": "Assets" } },
    });
  });

  it("collects each table's ids across nodes, children and footers", () => {
    const ids = gridDatasetReferenceIds(ledger());
    expect(Object.fromEntries(ids)).toEqual({
      accounts: ["1", "2", "3", "4"],
      items: ["a"],
    });
  });

  it("reports a reference whose id column is not on its level", () => {
    const dataset = ledger();
    dataset.levels.lines!.columns[1]!.reference = {
      table: "accounts",
      idColumn: "acct_id",
    };
    expect(gridDatasetReferenceProblems(dataset)).toEqual([
      'Dataset "ledger" level "lines" column "account" references table ' +
        '"accounts" through unknown id column "acct_id".',
    ]);
    expect(gridDatasetReferenceProblems(ledger())).toEqual([]);
  });
});
