import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { summarizeOperator } from "./FilterCard";

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
});
