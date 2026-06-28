import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { ColId } from "@sapporta/grid";
import { summarizeOperator } from "./FilterCard";
import { parseTableSearchParams } from "../grid-adapter/tgrid-table-url";

const authorColumn: ColumnSchema = {
  name: "author_id",
  label: "Author",
  kind: "number",
  foreignKey: { table: "authors", column: "id" },
};

describe("summarizeOperator", () => {
  it("uses direct equality wording for one selected list value", () => {
    expect(
      summarizeOperator(
        { id: "filter-1", column: "author_id", op: "in", values: ["jack"] },
        authorColumn,
      ),
    ).toBe("is");
  });

  it("keeps list wording for multiple selected values", () => {
    expect(
      summarizeOperator(
        {
          id: "filter-1",
          column: "author_id",
          op: "in",
          values: ["jack", "jane"],
        },
        authorColumn,
      ),
    ).toBe("is one of");
  });

  it("uses direct negative wording for one excluded list value", () => {
    expect(
      summarizeOperator(
        { id: "filter-1", column: "author_id", op: "nin", values: ["jack"] },
        authorColumn,
      ),
    ).toBe("is not");
  });

  it("uses direct equality wording for a URL foreign-key equality filter", () => {
    const parsed = parseTableSearchParams(
      new URLSearchParams("filter%5Bauthor_id%5D%5Beq%5D=jack"),
      new Set(["author_id"] as ColId[]),
      [authorColumn],
    );
    const condition = parsed.filters[0];
    if (!condition) throw new Error("expected one parsed filter");

    expect(condition).toMatchObject({
      column: "author_id",
      op: "in",
      values: ["jack"],
    });
    expect(summarizeOperator(condition, authorColumn)).toBe("is");
  });
});
