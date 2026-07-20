import { describe, expect, it } from "vitest";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import {
  fieldModelForColumn,
  foreignKeyFieldModelForColumn,
  type RecordFormFieldModel,
} from "./record-form-fields";

const titleColumn: ColumnSchema = {
  name: "title",
  label: "Title",
  kind: "text",
};

const projectColumn: ColumnSchema = {
  name: "project_id",
  label: "Project",
  kind: "number",
};

const projectLookup = {} as LookupCapabilities;
const fields: readonly RecordFormFieldModel[] = [
  { kind: "text", column: titleColumn },
  {
    kind: "foreignKey",
    column: projectColumn,
    lookup: projectLookup,
  },
];

describe("record form field metadata", () => {
  it("returns the field model for a column", () => {
    expect(fieldModelForColumn(fields, "title")).toEqual({
      kind: "text",
      column: titleColumn,
    });
  });

  it("returns a narrowed foreign-key field model", () => {
    expect(foreignKeyFieldModelForColumn(fields, "project_id").lookup).toBe(
      projectLookup,
    );
  });

  it("reports missing and mismatched metadata with the column name", () => {
    expect(() => fieldModelForColumn(fields, "missing")).toThrow(
      'column "missing"',
    );
    expect(() => foreignKeyFieldModelForColumn(fields, "title")).toThrow(
      'column "title"',
    );
  });
});
