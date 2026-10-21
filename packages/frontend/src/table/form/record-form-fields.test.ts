import { describe, expect, it } from "vitest";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { ColumnSchema, TableSchema } from "@sapporta/shared/contracts";
import { createLookupStore } from "../../lookup";
import {
  buildRecordFormFields,
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

  it("leaves the edited row and its descendants out of its tree parent field", () => {
    const accounts: TableSchema = {
      name: "accounts",
      label: "Accounts",
      immutable: false,
      searchable: true,
      rowLabelColumns: ["name"],
      children: [],
      columns: [
        { name: "id", label: "ID", kind: "number", primary: true },
        { name: "name", label: "Name", kind: "text" },
        {
          name: "parent_id",
          label: "Parent",
          kind: "number",
          foreignKey: { table: "accounts", column: "id" },
        },
      ],
      tree: {
        parentColumn: "parent_id",
        column: "name",
        defaultExpanded: true,
        matchContext: "ancestors",
      },
    };
    const store = createLookupStore({ tables: () => [accounts] });

    const editing = buildRecordFormFields({
      table: accounts,
      lookups: store,
      rowId: 7,
    });
    expect(foreignKeyFieldModelForColumn(editing, "parent_id").lookup).toBe(
      store.table("accounts", { notUnder: 7 }),
    );

    const creating = buildRecordFormFields({ table: accounts, lookups: store });
    expect(foreignKeyFieldModelForColumn(creating, "parent_id").lookup).toBe(
      store.table("accounts"),
    );
  });
});
