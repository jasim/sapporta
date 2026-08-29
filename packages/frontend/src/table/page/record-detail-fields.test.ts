import { describe, expect, it } from "vitest";
import type { ColumnSchema as GridColumnSchema } from "@sapporta/grid";
import { columnPreset } from "@sapporta/grid/column-preset";
import {
  StaticSearchLookup,
  StaticValueLookup,
  type LookupCapabilities,
} from "@sapporta/grid/lookup";
import type { ColumnSchema, TableSchema } from "@sapporta/shared/contracts";
import { setAppTimeZone } from "../../platform/app-time-zone";
import type { LookupStore } from "../../lookup";
import { createTGridColumnMapper } from "../tgrid/tgrid-column-mapper";
import {
  buildRecordDetailFields,
  formatRecordFieldValue,
  recordDetailTitle,
  recordFieldDraft,
} from "./record-detail-fields";

// These tests mount the pieces directly, so they publish the workspace zone
// that boot normally provides before any screen renders.
setAppTimeZone("UTC");

function staticLookupStore(): LookupStore {
  const lookup: LookupCapabilities = {
    valueLookup: new StaticValueLookup([]),
    searchLookup: new StaticSearchLookup([]),
  };
  return {
    table: () => lookup,
    foreignKey: () => lookup,
    requireForeignKey: () => lookup,
    clear: () => undefined,
  };
}

const columns: ColumnSchema[] = [
  { name: "id", label: "ID", kind: "number", primary: true, hasDefault: true },
  { name: "name", label: "Name", kind: "text", notNull: true },
  { name: "purchased_on", label: "Purchased", kind: "date" },
  { name: "acquired_at", label: "Acquired", kind: "timestamp" },
  { name: "cost", label: "Cost", kind: "number", displayFormat: "currency" },
  { name: "active", label: "Active", kind: "boolean" },
  { name: "locked", label: "Locked", kind: "text", apiWritable: false },
];

const table: TableSchema = {
  name: "assets",
  label: "Assets",
  immutable: false,
  searchable: true,
  rowLabelColumns: ["name"],
  columns,
  children: [],
};

function gridColumnsFor(
  schema: TableSchema,
  lookups: LookupStore,
): GridColumnSchema[] {
  const mapper = createTGridColumnMapper({ lookups });
  return schema.columns.map((column) =>
    mapper.columnFor({ tableName: schema.name, column, immutable: schema.immutable ?? false }),
  );
}

function detailFieldsFor(schema: TableSchema) {
  const lookups = staticLookupStore();
  return buildRecordDetailFields({
    table: schema,
    columns: gridColumnsFor(schema, lookups),
    columnMapper: createTGridColumnMapper({ lookups }),
    lookups,
  });
}

describe("buildRecordDetailFields", () => {
  it("keeps table-backed columns in view order and skips client columns", () => {
    const lookups = staticLookupStore();
    const gridColumns = gridColumnsFor(table, lookups);
    const clientColumn = columnPreset.text({
      id: "actions",
      name: "Actions",
      renderCell: () => null,
      meta: { kind: "client", id: "actions" },
    });
    const fields = buildRecordDetailFields({
      table,
      columns: [...gridColumns.slice(0, 2), clientColumn, ...gridColumns.slice(2)],
      columnMapper: createTGridColumnMapper({ lookups }),
      lookups,
    });

    expect(fields.map((field) => field.column.id)).toEqual([
      "id",
      "name",
      "purchased_on",
      "acquired_at",
      "cost",
      "active",
      "locked",
    ]);
  });

  it("derives editability from form policy, grid edit state, and temporal kinds", () => {
    const byId = new Map(
      detailFieldsFor(table).map((field) => [String(field.column.id), field]),
    );

    // The primary key identifies the record; it is never editable here.
    expect(byId.get("id")?.form).toBeNull();
    // Ordinary editable columns pick up their form control models.
    expect(byId.get("name")?.form?.kind).toBe("text");
    expect(byId.get("cost")?.form?.kind).toBe("currency");
    expect(byId.get("active")?.form?.kind).toBe("checkbox");
    // Grid cells cannot edit temporal columns, but the sheet's form controls
    // can — the reason this surface exists.
    expect(byId.get("purchased_on")?.form?.kind).toBe("date");
    expect(byId.get("acquired_at")?.form?.kind).toBe("timestamp");
    // Server-owned fields stay readonly, like in the record form.
    expect(byId.get("locked")?.form).toBeNull();
  });

  it("keeps every field readonly on an immutable table", () => {
    const immutable: TableSchema = { ...table, immutable: true };
    const lookups = staticLookupStore();
    const fields = buildRecordDetailFields({
      table: immutable,
      columns: gridColumnsFor(immutable, lookups),
      columnMapper: createTGridColumnMapper({ lookups }),
      lookups,
    });

    for (const field of fields) {
      expect(field.form).toBeNull();
    }
  });

  it("respects a view that disabled editing on a non-temporal column", () => {
    const lookups = staticLookupStore();
    const gridColumns = gridColumnsFor(table, lookups).map((column) =>
      column.id === "name" ? { ...column, edit: undefined } : column,
    );
    const fields = buildRecordDetailFields({
      table,
      columns: gridColumns,
      columnMapper: createTGridColumnMapper({ lookups }),
      lookups,
    });

    const name = fields.find((field) => field.column.id === "name");
    expect(name?.form).toBeNull();
  });
});

describe("recordFieldDraft", () => {
  const formOf = (columnId: string) => {
    const field = detailFieldsFor(table).find(
      (candidate) => candidate.column.id === columnId,
    );
    if (!field?.form) throw new Error(`expected form model for ${columnId}`);
    return field.form;
  };

  it("converts stored values into control drafts", () => {
    expect(recordFieldDraft(formOf("name"), "Forklift")).toBe("Forklift");
    expect(recordFieldDraft(formOf("name"), null)).toBe("");
    expect(recordFieldDraft(formOf("cost"), 18500)).toBe("18500");
    expect(recordFieldDraft(formOf("active"), true)).toBe(true);
    expect(recordFieldDraft(formOf("active"), null)).toBe(false);
    expect(recordFieldDraft(formOf("purchased_on"), "2026-08-23")).toBe(
      "2026-08-23",
    );
    // The datetime-local control speaks wall-clock text on the app zone (UTC
    // in this test).
    expect(recordFieldDraft(formOf("acquired_at"), "2026-08-23T11:08:00Z")).toBe(
      "2026-08-23T11:08:00",
    );
  });
});

describe("formatRecordFieldValue", () => {
  const metaOf = (columnId: string) => {
    const field = detailFieldsFor(table).find(
      (candidate) => candidate.column.id === columnId,
    );
    if (!field) throw new Error(`expected field for ${columnId}`);
    return field.meta;
  };

  it("formats values the way grid cells do", () => {
    expect(formatRecordFieldValue(metaOf("name"), "Forklift")).toBe("Forklift");
    expect(formatRecordFieldValue(metaOf("name"), null)).toBe("");
    expect(formatRecordFieldValue(metaOf("cost"), 18500)).toMatch(
      /^18[,. ]500[.,]00$/,
    );
    expect(formatRecordFieldValue(metaOf("active"), true)).toBe("Yes");
    expect(formatRecordFieldValue(metaOf("active"), false)).toBe("No");
    expect(formatRecordFieldValue(metaOf("active"), null)).toBe("");
    expect(
      formatRecordFieldValue(metaOf("acquired_at"), "2026-08-23T11:08:00Z"),
    ).toBe("2026-08-23 11:08");
  });
});

describe("recordDetailTitle", () => {
  it("uses the card-title column value and falls back to null when empty", () => {
    const lookups = staticLookupStore();
    const gridColumns = gridColumnsFor(table, lookups).map((column) =>
      column.id === "name"
        ? {
            ...column,
            meta: { ...(column.meta as object), cardRole: "title" },
          }
        : column,
    );
    const fields = buildRecordDetailFields({
      table,
      columns: gridColumns,
      columnMapper: createTGridColumnMapper({ lookups }),
      lookups,
    });

    expect(recordDetailTitle(fields, { name: "Forklift 2.5t" })).toBe(
      "Forklift 2.5t",
    );
    expect(recordDetailTitle(fields, { name: "" })).toBeNull();
    expect(recordDetailTitle(fields, {})).toBeNull();
  });

  it("returns null when no column carries the title role", () => {
    expect(recordDetailTitle(detailFieldsFor(table), { name: "x" })).toBeNull();
  });
});
