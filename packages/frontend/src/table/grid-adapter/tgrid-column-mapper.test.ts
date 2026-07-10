import { describe, expect, it } from "vitest";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { preset } from "@sapporta/grid/column-preset";
import { StaticSearchLookup, StaticValueLookup } from "@sapporta/grid/lookup";
import {
  createTGridColumnMapper,
  tableColumnPresetWidth,
} from "./tgrid-column-mapper";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { LookupStore } from "../../lookup";

const valueLookup = new StaticValueLookup([{ value: "a", label: "Alpha" }]);
const searchLookup = new StaticSearchLookup([{ value: "b", label: "Beta" }]);
const lookup: LookupCapabilities = {
  valueLookup,
  searchLookup,
};
const lookups: LookupStore = {
  table: () => lookup,
  foreignKey: () => lookup,
  requireForeignKey: () => lookup,
  clear: () => undefined,
};
const columnMapper = createTGridColumnMapper({ lookups });

function mapColumn(column: ColumnSchema, immutable = false) {
  return columnMapper.columnFor({
    tableName: "things",
    column,
    immutable,
  });
}

describe("TGridColumnMapper.columnFor", () => {
  it("maps every table display type to the matching preset kind", () => {
    const tableColumns = [
      { name: "id", label: "ID", primary: true, kind: "number" },
      {
        name: "owner_id",
        label: "Owner",
        kind: "number",
        foreignKey: { table: "users", column: "id" },
      },
      {
        name: "status",
        label: "Status",
        kind: "text",
        select: { options: ["draft", "done"] },
      },
      { name: "active", label: "Active", kind: "boolean" },
      { name: "created_at", label: "Created at", kind: "timestamp" },
      { name: "qty", label: "Qty", kind: "number" },
      {
        name: "price",
        label: "Price",
        kind: "number",
        displayFormat: "currency",
      },
      {
        name: "rate",
        label: "Rate",
        kind: "number",
        displayFormat: "percentage",
      },
      { name: "name", label: "Name", kind: "text" },
    ] satisfies ColumnSchema[];
    const columns = tableColumns.map((column) => mapColumn(column));

    expect(columns.map((c) => preset(c)?.kind)).toEqual([
      "identifier",
      "foreignKey",
      "select",
      "boolean",
      "date",
      "number",
      "currency",
      "percentage",
      "text",
    ]);
  });

  it("applies editability and table metadata", () => {
    const columns = [
      mapColumn({ name: "name", label: "Name", kind: "text" }),
      mapColumn({
        name: "created_at",
        label: "Created at",
        kind: "date",
      }),
    ];

    expect(columns.map((c) => c.id)).toEqual(["name", "created_at"]);
    expect(columns[0].name).toBe("Name");
    expect(columns[0].edit).toBeDefined();
    expect(columns[1].edit).toBeUndefined();
    expect(columns[0].meta).toMatchObject({
      table: "things",
      displayType: "text",
      schema: { name: "name" },
    });
  });

  it("makes immutable tables read-only", () => {
    const column = mapColumn(
      { name: "name", label: "Name", kind: "text" },
      true,
    );

    expect(column.edit).toBeUndefined();
  });

  it("maps textDisplay into the text preset display", () => {
    const column = mapColumn({
      name: "body",
      label: "Body",
      kind: "text",
      textDisplay: "markdown",
    });
    const p = preset(column);

    expect(p?.kind).toBe("text");
    if (!p || !("text" in p)) throw new Error("expected text preset");
    expect(p.text.display).toBe("markdown");
  });

  it("maps numeric display metadata into the numeric preset display", () => {
    const column = mapColumn({
      name: "balance",
      label: "Balance",
      kind: "number",
      displayFormat: "currency",
      colorRule: "signed",
      zeroDisplay: "dot",
      strong: true,
    });
    const p = preset(column);

    expect(p?.kind).toBe("currency");
    if (!p || !("currency" in p)) throw new Error("expected currency preset");
    expect(p.currency).toEqual({
      colorRule: "signed",
      zeroDisplay: "dot",
      strong: true,
    });
  });

  it("defaults currency zero display to a dot", () => {
    const column = mapColumn({
      name: "price",
      label: "Price",
      kind: "number",
      displayFormat: "currency",
    });
    const p = preset(column);

    expect(p?.kind).toBe("currency");
    if (!p || !("currency" in p)) throw new Error("expected currency preset");
    expect(p.currency.zeroDisplay).toBe("dot");
  });

  it("assigns FK label and editor lookups to preset data", () => {
    const column = mapColumn({
      name: "owner_id",
      label: "Owner",
      kind: "number",
      foreignKey: { table: "users", column: "id" },
    });
    const p = preset(column);

    expect(p?.kind).toBe("foreignKey");
    if (!p || !("lookup" in p)) throw new Error("expected FK preset");
    expect(p.lookup.valueLookup.entryForValue("a")?.label).toBe("Alpha");
    expect(p.lookup.searchLookup).toBe(searchLookup);
  });
});

describe("tableColumnPresetWidth", () => {
  it("converts table character width hints to preset tracks", () => {
    expect(
      tableColumnPresetWidth({
        name: "a",
        label: "A",
        kind: "text",
        width: 12,
      }),
    ).toEqual({
      track: "calc(12ch + 1rem)",
    });
    expect(
      tableColumnPresetWidth({
        name: "b",
        label: "B",
        kind: "text",
        minWidth: 8,
        maxWidth: 20,
      }),
    ).toEqual({ track: "minmax(calc(8ch + 1rem), calc(20ch + 1rem))" });
    expect(
      tableColumnPresetWidth({ name: "c", label: "C", kind: "text" }),
    ).toBeUndefined();
  });
});
