import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import type { CellEditorProps } from "../grid/types/schema";
import { rootPath, childPath } from "../grid/types/identity";
import { TextCell } from "./cells/TextCell";
import { StaticSearchLookup } from "../modules/lookup-cache/search-lookup";
import { StaticValueLookup } from "../modules/lookup-cache/value-lookup";
import {
  foreignKey,
  columnPreset,
  identifier,
  kind,
  lookupValue,
  meta,
  number,
  parse,
  preset,
  select,
  width,
} from "./index";
import { presetRuntime } from "./preset";
import { levelNameFromPath } from "../grid/react/Grid";

describe("columnPreset columns", () => {
  it("identifier creates a compact readonly preset with a renderer", () => {
    const column = identifier({ id: "id", name: "ID" });
    const p = preset(column);

    expect(column.editCell).toBeUndefined();
    expect(column.editTriggers).toEqual([]);
    expect(typeof column.renderCell).toBe("function");
    expect(p?.kind).toBe("identifier");
    expect(p?.layout.align).toBe("left");
    expect(p?.layout.width).toBe("compact");
    expect(presetRuntime(column)?.editBehavior.editable).toBe(false);
  });

  it("number stores numeric preset facts without leaking into meta", () => {
    const appMeta = { schemaName: "amount" };
    const column = number({
      id: "amount",
      name: "Amount",
      colorRule: "signed",
      zeroDisplay: "blank",
      strong: true,
      meta: appMeta,
    });
    const p = preset(column);

    expect(p?.kind).toBe("number");
    expect(p?.layout.align).toBe("right");
    expect(width(column)).toBe("numeric");
    expect(meta(column)).toBe(appMeta);
    expect(column.meta).toBe(appMeta);
    expect(p && "number" in p ? p.number : undefined).toEqual({
      colorRule: "signed",
      zeroDisplay: "blank",
      strong: true,
    });
  });

  it("numeric renderer uses a middle dot for dot zero display", () => {
    const column = columnPreset.currency({
      id: "amount",
      name: "Amount",
      zeroDisplay: "dot",
    });
    const rendered = column.renderCell({
      value: 0,
      column,
      path: rootPath("books"),
      row: {
        kind: "data",
        id: "books#1" as never,
        columns: { amount: 0 },
        hasChildren: false,
        source: { levelName: "books", columns: { amount: 0 } },
      },
    });

    expect(isValidElement(rendered)).toBe(true);
    expect(
      isValidElement<{ text?: string }>(rendered) ? rendered.props.text : null,
    ).toBe("·");
  });

  it("select normalizes string and object options", () => {
    const column = select({
      id: "unit",
      name: "Unit",
      options: ["g", "oz", { value: "serving", label: "serving" }],
    });
    const p = preset(column);

    expect(p?.kind).toBe("select");
    expect(p && "select" in p ? p.select.options : []).toEqual([
      { value: "g", label: "g" },
      { value: "oz", label: "oz" },
      { value: "serving", label: "serving" },
    ]);
  });

  it("text display opts the preset renderer into four-line clamping", () => {
    for (const mode of ["multiLine", "markdown"] as const) {
      const column = columnPreset.text({
        id: "quote",
        name: "Quote",
        display: mode,
      });
      const p = preset(column);

      expect(p?.kind).toBe("text");
      if (!p || !("text" in p)) throw new Error("expected text preset");
      expect(p.text.display).toBe(mode);

      const rendered = TextCell({
        value: "line 1\nline 2\nline 3\nline 4\nline 5",
        runtime: presetRuntime(column)!,
        column,
        path: rootPath("books"),
        row: {
          kind: "data",
          id: "books#1" as never,
          columns: { quote: "line 1" },
          hasChildren: false,
          source: { levelName: "books", columns: { quote: "line 1" } },
        },
      });

      expect(isValidElement(rendered)).toBe(true);
      expect(
        isValidElement<{ style?: unknown }>(rendered)
          ? rendered.props.style
          : null,
      ).toMatchObject({
        WebkitLineClamp: 4,
        overflow: "hidden",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      });
    }
  });

  it("plain text cells keep single-line truncation in the preset", () => {
    const column = columnPreset.text({ id: "title", name: "Title" });
    const p = preset(column);
    if (!p || p.kind !== "text") throw new Error("expected text preset");

    const rendered = TextCell({
      value: "A short title",
      runtime: presetRuntime(column)!,
      column,
      path: rootPath("books"),
      row: {
        kind: "data",
        id: "books#1" as never,
        columns: { title: "A short title" },
        hasChildren: false,
        source: { levelName: "books", columns: { title: "A short title" } },
      },
    });

    expect(isValidElement(rendered)).toBe(true);
    expect(
      isValidElement<{ style?: unknown }>(rendered)
        ? rendered.props.style
        : null,
    ).toMatchObject({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  it("lookupValue and foreignKey store lookup capabilities", () => {
    const valueLookup = new StaticValueLookup([
      { value: "1", label: "Breakfast" },
    ]);
    const searchLookup = new StaticSearchLookup([
      { value: "2", label: "Lunch" },
    ]);
    const generic = lookupValue({
      id: "mealId",
      name: "Meal",
      valueLookup,
      searchLookup,
    });
    const fk = foreignKey({
      id: "mealId",
      name: "Meal",
      valueLookup,
      searchLookup,
    });

    const genericPreset = preset(generic);
    const fkPreset = preset(fk);

    expect(genericPreset?.kind).toBe("lookupValue");
    if (!genericPreset || !("lookup" in genericPreset)) {
      throw new Error("expected lookup value preset");
    }
    expect(genericPreset.lookup.valueLookup).toBe(valueLookup);
    expect(genericPreset.lookup.searchLookup).toBe(searchLookup);

    expect(fkPreset?.kind).toBe("foreignKey");
    if (!fkPreset || !("lookup" in fkPreset)) {
      throw new Error("expected FK preset");
    }
    expect(fkPreset.lookup.valueLookup).toBe(valueLookup);
    expect(fkPreset.lookup.searchLookup).toBe(searchLookup);
  });

  it("public preset exposes only inspectable preset facts", () => {
    const parser = (value: string, _props: CellEditorProps) => Number(value);
    const column = columnPreset.column({
      kind: "customThing",
      id: "custom",
      name: "Custom",
      width: { track: "12rem" },
      parse: parser,
    });

    expect(kind(column)).toBe("customThing");
    expect(width(column)).toEqual({ track: "12rem" });
    expect(parse(column)).toBe(parser);
    const p = preset(column);
    expect(p && "meta" in p).toBe(false);
    expect(p && "valueCodec" in p).toBe(false);
    expect(p && "cellView" in p).toBe(false);
    expect(p && "editBehavior" in p).toBe(false);
    expect(p && "headerBehavior" in p).toBe(false);
    expect(presetRuntime(column)?.valueCodec.parse).toBe(parser);
  });
});

describe("base grid chrome context helpers", () => {
  it("derives the schema level key from the path", () => {
    const root = rootPath("foodLogs");
    const child = childPath(root, "log.1", "entries");

    expect(levelNameFromPath(root)).toBe("foodLogs");
    expect(levelNameFromPath(child)).toBe("entries");
  });
});
