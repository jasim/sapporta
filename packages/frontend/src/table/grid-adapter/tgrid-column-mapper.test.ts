import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import type { ColumnSchema, TableSchema } from "@sapporta/shared/contracts";
import { ExpandCell } from "@sapporta/grid";
import { preset } from "@sapporta/grid/column-preset";
import { StaticSearchLookup } from "@sapporta/grid/lookup";
import { StaticValueLookup } from "@sapporta/grid/lookup";
import {
  createTGridColumnMapper,
  tableColumnPresetWidth,
} from "./tgrid-column-mapper";
import type { TGridLookupResolver } from "./tgrid-lookup-resolver";
import type { TableForeignKeyLookupBundle } from "@/table/lookup/table-lookup-registry";

const valueLookup = new StaticValueLookup([{ value: "a", label: "Alpha" }]);
const searchLookup = new StaticSearchLookup([{ value: "b", label: "Beta" }]);
const bundle: TableForeignKeyLookupBundle = {
  key: "things.owner_id->users.id",
  sourceTable: "things",
  sourceColumn: "owner_id",
  targetTable: "users",
  targetColumn: "id",
  valueLookup,
  searchLookup,
};
const lookupResolver: TGridLookupResolver = {
  bundleFor: () => bundle,
};
const columnMapper = createTGridColumnMapper(lookupResolver);

function table(columns: ColumnSchema[], immutable = false): TableSchema {
  return {
    name: "things",
    label: "Things",
    immutable,
    columns,
    children: [],
  };
}

describe("TGridColumnMapper.columnsFor", () => {
  it("maps every table display type to the matching preset kind", () => {
    const columns = columnMapper.columnsFor({
      table: table([
        { name: "id", primary: true, kind: "number" },
        {
          name: "owner_id",
          kind: "number",
          foreignKey: { table: "users", column: "id" },
        },
        {
          name: "status",
          kind: "text",
          select: { options: ["draft", "done"] },
        },
        { name: "active", kind: "boolean" },
        { name: "created_at", kind: "timestamp" },
        { name: "qty", kind: "number" },
        { name: "price", kind: "number", displayFormat: "currency" },
        { name: "rate", kind: "number", displayFormat: "percentage" },
        { name: "name", kind: "text" },
      ]),
      immutable: false,
      expandable: false,
    });

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

  it("applies projection, hidden columns, editability, and metadata", () => {
    const columns = columnMapper.columnsFor({
      table: table(
        [
          { name: "id", primary: true, kind: "number" },
          { name: "name", header: "Name", kind: "text" },
          { name: "created_at", kind: "date" },
          { name: "secret", kind: "text", visuallyHidden: true },
        ],
        false,
      ),
      includedColumnNames: ["name", "secret", "created_at"],
      immutable: false,
      expandable: false,
    });

    expect(columns.map((c) => c.id)).toEqual(["name", "created_at"]);
    expect(columns[0].name).toBe("Name");
    expect(columns[0].editCell).toBeDefined();
    expect(columns[1].editCell).toBeUndefined();
    expect(columns[0].meta).toMatchObject({
      table: "things",
      displayType: "text",
      schema: { name: "name" },
    });
  });

  it("makes immutable tables read-only", () => {
    const columns = columnMapper.columnsFor({
      table: table([{ name: "name", kind: "text" }], true),
      immutable: true,
      expandable: false,
    });

    expect(columns[0].editCell).toBeUndefined();
    expect(columns[0].editTriggers).toEqual([]);
  });

  it("maps textDisplay into the text preset display", () => {
    const columns = columnMapper.columnsFor({
      table: table([{ name: "body", kind: "text", textDisplay: "markdown" }]),
      immutable: false,
      expandable: false,
    });
    const p = preset(columns[0]);

    expect(p?.kind).toBe("text");
    if (!p || !("text" in p)) throw new Error("expected text preset");
    expect(p.text.display).toBe("markdown");
  });

  it("maps numeric display metadata into the numeric preset display", () => {
    const columns = columnMapper.columnsFor({
      table: table([
        {
          name: "balance",
          kind: "number",
          displayFormat: "currency",
          colorRule: "signed",
          zeroDisplay: "dot",
          strong: true,
        },
      ]),
      immutable: false,
      expandable: false,
    });
    const p = preset(columns[0]);

    expect(p?.kind).toBe("currency");
    if (!p || !("currency" in p)) throw new Error("expected currency preset");
    expect(p.currency).toEqual({
      colorRule: "signed",
      zeroDisplay: "dot",
      strong: true,
    });
  });

  it("defaults currency zero display to a dot", () => {
    const columns = columnMapper.columnsFor({
      table: table([
        {
          name: "price",
          kind: "number",
          displayFormat: "currency",
        },
      ]),
      immutable: false,
      expandable: false,
    });
    const p = preset(columns[0]);

    expect(p?.kind).toBe("currency");
    if (!p || !("currency" in p)) throw new Error("expected currency preset");
    expect(p.currency.zeroDisplay).toBe("dot");
  });

  it("assigns FK label and editor lookups to preset data", () => {
    const columns = columnMapper.columnsFor({
      table: table([
        {
          name: "owner_id",
          kind: "number",
          foreignKey: { table: "users", column: "id" },
        },
      ]),
      immutable: false,
      expandable: false,
    });
    const p = preset(columns[0]);

    expect(p?.kind).toBe("foreignKey");
    if (!p || !("lookup" in p)) throw new Error("expected FK preset");
    expect(p.lookup.valueLookup.entryForValue("a")?.label).toBe("Alpha");
    expect(p.lookup.searchLookup).toBe(searchLookup);
  });

  it("wraps the first visible column for expandable levels", () => {
    const columns = columnMapper.columnsFor({
      table: table([{ name: "id", primary: true, kind: "number" }]),
      immutable: false,
      expandable: true,
    });
    const rendered = columns[0].renderCell({
      value: 1,
      column: columns[0],
      path: "things" as never,
      row: {
        kind: "data",
        id: "things#1" as never,
        rowSelectable: true,
        columns: { id: 1 },
        hasChildren: false,
        source: { levelName: "things", columns: { id: 1 } },
      },
    });

    expect(isValidElement(rendered)).toBe(true);
    expect(isValidElement(rendered) ? rendered.type : null).toBe(ExpandCell);
  });
});

describe("tableColumnPresetWidth", () => {
  it("converts table character width hints to preset tracks", () => {
    expect(
      tableColumnPresetWidth({ name: "a", kind: "text", width: 12 }),
    ).toEqual({
      track: "calc(12ch + 1rem)",
    });
    expect(
      tableColumnPresetWidth({
        name: "b",
        kind: "text",
        minWidth: 8,
        maxWidth: 20,
      }),
    ).toEqual({ track: "minmax(calc(8ch + 1rem), calc(20ch + 1rem))" });
    expect(tableColumnPresetWidth({ name: "c", kind: "text" })).toBeUndefined();
  });
});
