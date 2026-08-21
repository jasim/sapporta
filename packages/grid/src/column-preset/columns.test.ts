import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it } from "vitest";
import type { LevelRow } from "../core/types/level-row";
import type { CellEditorProps } from "../core/types/schema";
import { childPath, makeRowId, rootPath } from "../core/types/identity";
import { TextCell } from "./cells/TextCell";
import {
  CachedValueLookup,
  StaticSearchLookup,
  StaticValueLookup,
  type LookupValue,
} from "../lookup";
import {
  foreignKey,
  columnPresetWidthForSizing,
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
import { levelNameFromPath } from "../core/react/Grid";

describe("columnPreset columns", () => {
  it("identifier creates a compact readonly preset with a renderer", () => {
    const column = identifier({ id: "id", name: "ID" });
    const p = preset(column);

    expect(column.edit).toBeUndefined();
    expect(typeof column.renderCell).toBe("function");
    expect(p?.kind).toBe("identifier");
    expect(p?.layout.align).toBe("left");
    expect(p?.layout.width).toBe("compact");
    expect(presetRuntime(column)?.edit).toBeUndefined();
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
        id: makeRowId(rootPath("books"), "1"),
        rowSelectable: true,
        columns: { amount: 0 },
        hasChildren: false,
        source: { rowKey: "1", levelName: "books", columns: { amount: 0 } },
      },
      activation: null,
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

  it("select copy emits raw values and normalized labels", async () => {
    const column = select({
      id: "status",
      name: "Status",
      options: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
    });
    if (!column.copy) throw new Error("expected select copy behavior");
    const rows = [
      levelRow({ status: "open" }),
      levelRow({ status: "unknown" }),
    ];

    const copyColumns = await column.copy({
      path: rootPath("books"),
      column,
      rows,
    });

    expect(copyColumns.map((copyColumn) => copyColumn.header)).toEqual([
      "status",
      "status_label",
    ]);
    expect(
      copyColumns.map((copyColumn) => copyColumn.valueAt(rows[0], 0)),
    ).toEqual(["open", "Open"]);
    expect(
      copyColumns.map((copyColumn) => copyColumn.valueAt(rows[1], 1)),
    ).toEqual(["unknown", "unknown"]);
  });

  it("preset copy options replace labeled-value defaults", async () => {
    const column = select({
      id: "status",
      name: "Status",
      options: [{ value: "open", label: "Open" }],
      copy: () => [
        {
          header: "workflow_status",
          valueAt: (row) => row.columns.status,
        },
      ],
    });
    if (!column.copy) throw new Error("expected custom copy behavior");
    const row = levelRow({ status: "open" });

    const copyColumns = await column.copy({
      path: rootPath("books"),
      column,
      rows: [row],
    });

    expect(copyColumns.map((copyColumn) => copyColumn.header)).toEqual([
      "workflow_status",
    ]);
    expect(copyColumns[0].valueAt(row, 0)).toBe("open");
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
          id: makeRowId(rootPath("books"), "1"),
          rowSelectable: true,
          columns: { quote: "line 1" },
          hasChildren: false,
          source: {
            rowKey: "1",
            levelName: "books",
            columns: { quote: "line 1" },
          },
        },
        activation: null,
      });

      const textSpan = findElementByClassName(rendered, "textCell");
      expect(textSpan).not.toBeNull();
      const className = textSpan?.props.className;
      expect(className).toEqual(expect.stringContaining("textCell"));
      expect(className).toEqual(expect.stringContaining("multiLineTextCell"));
      expect(
        findElementByGridPart(rendered, "text-cell-tooltip-content"),
      ).not.toBeNull();
    }
  });

  it("plain text cells keep single-line truncation and render a full-text tooltip", () => {
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
        id: makeRowId(rootPath("books"), "1"),
        rowSelectable: true,
        columns: { title: "A short title" },
        hasChildren: false,
        source: {
          rowKey: "1",
          levelName: "books",
          columns: { title: "A short title" },
        },
      },
      activation: null,
    });

    const textSpan = findElementByClassName(rendered, "textCell");
    expect(textSpan).not.toBeNull();
    const className = textSpan?.props.className;
    expect(className).toEqual(expect.stringContaining("textCell"));
    expect(className).not.toEqual(expect.stringContaining("multiLineTextCell"));
    expect(
      findElementByGridPart(rendered, "text-cell-tooltip-trigger"),
    ).not.toBeNull();
    expect(
      findElementByGridPart(rendered, "text-cell-tooltip-content"),
    ).not.toBeNull();
  });

  it("empty text cells do not render a tooltip", () => {
    const column = columnPreset.text({ id: "title", name: "Title" });

    const rendered = TextCell({
      value: "",
      runtime: presetRuntime(column)!,
      column,
      path: rootPath("books"),
      row: {
        kind: "data",
        id: makeRowId(rootPath("books"), "1"),
        rowSelectable: true,
        columns: { title: "" },
        hasChildren: false,
        source: { rowKey: "1", levelName: "books", columns: { title: "" } },
      },
      activation: null,
    });

    expect(findElementByClassName(rendered, "textCell")).not.toBeNull();
    expect(
      findElementByGridPart(rendered, "text-cell-tooltip-content"),
    ).toBeNull();
  });

  it("identifier text cells do not render a tooltip", () => {
    const column = identifier({ id: "id", name: "ID" });

    const rendered = TextCell({
      value: "books#1",
      runtime: presetRuntime(column)!,
      column,
      path: rootPath("books"),
      row: {
        kind: "data",
        id: makeRowId(rootPath("books"), "1"),
        rowSelectable: true,
        columns: { id: "books#1" },
        hasChildren: false,
        source: {
          rowKey: "1",
          levelName: "books",
          columns: { id: "books#1" },
        },
      },
      activation: null,
    });

    expect(
      findElementByClassName(rendered, "identifierTextCell"),
    ).not.toBeNull();
    expect(
      findElementByGridPart(rendered, "text-cell-tooltip-content"),
    ).toBeNull();
  });

  it("converts character sizing hints to preset width tracks", () => {
    expect(columnPresetWidthForSizing({ width: 12 })).toEqual({
      track: "calc(12ch + 1rem)",
    });
    expect(columnPresetWidthForSizing({ minWidth: 8, maxWidth: 20 })).toEqual({
      track: "minmax(calc(8ch + 1rem), calc(20ch + 1rem))",
    });
    expect(columnPresetWidthForSizing({})).toBeUndefined();
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

  it("lookup-backed copy loads labels and falls back to formatted values", async () => {
    let loadedValues: readonly LookupValue[] = [];
    const valueLookup = new CachedValueLookup({
      loadEntriesForValues: async (values) => {
        loadedValues = values;
        return [{ value: "acct_123", label: "Cash" }];
      },
    });
    const column = foreignKey({
      id: "account_id",
      name: "Account",
      valueLookup,
    });
    if (!column.copy) throw new Error("expected lookup copy behavior");
    const rows = [
      levelRow({ account_id: "acct_123" }),
      levelRow({ account_id: "acct_missing" }),
    ];

    const copyColumns = await column.copy({
      path: rootPath("books"),
      column,
      rows,
    });

    expect(new Set(loadedValues)).toEqual(
      new Set(["acct_123", "acct_missing"]),
    );
    expect(copyColumns.map((copyColumn) => copyColumn.header)).toEqual([
      "account_id",
      "account_id_label",
    ]);
    expect(
      copyColumns.map((copyColumn) => copyColumn.valueAt(rows[0], 0)),
    ).toEqual(["acct_123", "Cash"]);
    expect(
      copyColumns.map((copyColumn) => copyColumn.valueAt(rows[1], 1)),
    ).toEqual(["acct_missing", "acct_missing"]);
    expect(
      lookupValue({
        id: "meal_id",
        name: "Meal",
        valueLookup: new StaticValueLookup([
          { value: "1", label: "Breakfast" },
        ]),
      }).copy,
    ).toBeDefined();
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
    expect(p && "edit" in p).toBe(false);
    expect(p && "headerBehavior" in p).toBe(false);
    expect(presetRuntime(column)?.valueCodec.parse).toBe(parser);
  });
});

type TestElementProps = {
  children?: ReactNode;
  className?: unknown;
  "data-grid-part"?: unknown;
};

function findElementByClassName(
  rendered: ReactNode,
  expectedClassName: string,
): ReactElement<TestElementProps> | null {
  return findElement(rendered, (props) => {
    return (
      typeof props.className === "string" &&
      props.className.includes(expectedClassName)
    );
  });
}

function findElementByGridPart(
  rendered: ReactNode,
  gridPart: string,
): ReactElement<TestElementProps> | null {
  return findElement(rendered, (props) => props["data-grid-part"] === gridPart);
}

function findElement(
  rendered: ReactNode,
  predicate: (props: TestElementProps) => boolean,
): ReactElement<TestElementProps> | null {
  if (!isValidElement<TestElementProps>(rendered)) return null;
  if (predicate(rendered.props)) return rendered;

  for (const child of Children.toArray(rendered.props.children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function levelRow(columns: Record<string, unknown>): LevelRow {
  return {
    kind: "data",
    id: makeRowId(rootPath("books"), "1"),
    rowSelectable: true,
    columns,
    hasChildren: false,
    source: { rowKey: "1", levelName: "books", columns },
  };
}

describe("base grid chrome context helpers", () => {
  it("derives the schema level key from the path", () => {
    const root = rootPath("foodLogs");
    const child = childPath(root, "log.1", "entries");

    expect(levelNameFromPath(root)).toBe("foodLogs");
    expect(levelNameFromPath(child)).toBe("entries");
  });
});
