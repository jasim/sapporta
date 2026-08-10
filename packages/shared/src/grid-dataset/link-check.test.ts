import { describe, expect, it } from "vitest";
import { gridDatasetLinkProblems } from "./link-check.js";
import type { GridDataset, GridDatasetLevel } from "./result-schema.js";

function dataset(level: Partial<GridDatasetLevel>): GridDataset {
  return {
    name: "aging",
    label: "Aging",
    rootLevel: "customers",
    levels: {
      customers: {
        columns: [
          { id: "customer_id", label: "ID", kind: "number" },
          { id: "name", label: "Name", kind: "text" },
        ],
        childLevels: [],
        ...level,
      },
    },
    nodes: [],
  };
}

describe("gridDatasetLinkProblems", () => {
  it("accepts links whose binds and placeholders name level columns", () => {
    const ds = dataset({
      columns: [
        {
          id: "customer_id",
          label: "ID",
          kind: "number",
          links: [
            {
              kind: "table",
              table: "customers",
              bind: { id: "customer_id" },
            },
            { kind: "url", href: "https://crm.example.com/{customer_id}" },
          ],
        },
        { id: "name", label: "Name", kind: "text" },
      ],
      rowLinks: [
        { kind: "report", report: "statement", bind: { c: "customer_id" } },
      ],
    });
    expect(gridDatasetLinkProblems(ds)).toEqual([]);
  });

  it("reports binds naming columns the level does not have", () => {
    const ds = dataset({
      rowLinks: [
        { kind: "report", report: "statement", bind: { c: "missing_col" } },
      ],
    });
    expect(gridDatasetLinkProblems(ds)).toEqual([
      'Dataset "aging" level "customers" rowLinks declares a link ' +
        'reading unknown column "missing_col".',
    ]);
  });

  it("reports url placeholders naming columns the level does not have", () => {
    const ds = dataset({
      columns: [
        {
          id: "name",
          label: "Name",
          kind: "text",
          links: [{ kind: "url", href: "/x/{typo_id}" }],
        },
      ],
    });
    expect(gridDatasetLinkProblems(ds)).toEqual([
      'Dataset "aging" level "customers" column "name" declares a link ' +
        'reading unknown column "typo_id".',
    ]);
  });

  it("counts visually hidden helper columns as readable", () => {
    const ds = dataset({
      columns: [
        { id: "name", label: "Name", kind: "text" },
        {
          id: "helper_id",
          label: "Helper",
          kind: "number",
          visuallyHidden: true,
        },
      ],
      rowLinks: [
        { kind: "table", table: "customers", bind: { id: "helper_id" } },
      ],
    });
    expect(gridDatasetLinkProblems(ds)).toEqual([]);
  });
});
