// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { inMemoryGridDataSource } from "../../data-sources/memory/in-memory-grid-source";
import { createGridRuntime } from "../../runtime/runtime";
import { makeLevelRowId, makeRowId, rootPath } from "../../types/identity";
import type { FooterRow, TreeNode } from "../../types/level-row";
import type { ColumnSchema, GridSchema } from "../../types/schema";
import { GridLevel } from "../GridLevel";
import { GridRuntimeProvider } from "../GridRuntimeProvider";
import { treeExpansionActivation, withTreeColumn } from "./TreeCellFrame";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const path = rootPath("accounts");
const id = (key: string) => makeRowId(path, key);

const textColumn = (columnId: string, name: string): ColumnSchema => ({
  id: columnId,
  name,
  renderCell: ({ value }) => String(value ?? ""),
});

const schema: GridSchema = {
  rootLevel: "accounts",
  levels: {
    accounts: {
      name: "accounts",
      rowHeaderColumn: "none",
      columns: [
        withTreeColumn(textColumn("name", "Account")),
        textColumn("description", "Description"),
      ],
      options: {},
      childLevels: [],
      tree: { parentKeyField: "parent_id" },
    },
  },
};

const nodes: TreeNode[] = [
  { rowKey: "1", levelName: "accounts", columns: { name: "Assets" } },
  {
    rowKey: "2",
    levelName: "accounts",
    columns: { name: "Checking", parent_id: 1 },
  },
  {
    rowKey: "3",
    levelName: "accounts",
    columns: { name: "Savings", parent_id: 1 },
  },
  { rowKey: "4", levelName: "accounts", columns: { name: "Equity" } },
];

let mounted: { container: HTMLDivElement; root: Root } | null = null;

afterEach(async () => {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
});

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  mounted = { container, root };
  return container;
}

function treeRuntime(footerRows?: readonly FooterRow[]) {
  return createGridRuntime({
    schema,
    dataSource: inMemoryGridDataSource({
      schema,
      tree: nodes,
      levels: {
        accounts: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
          footerRows,
        },
      },
    }),
  });
}

async function renderTree(
  presentation: "tabular" | "cards" = "tabular",
  footerRows?: readonly FooterRow[],
) {
  const runtime = treeRuntime(footerRows);
  const container = await render(
    createElement(GridRuntimeProvider, {
      runtime,
      children: createElement(GridLevel, { path, presentation }),
    }),
  );
  return { runtime, container };
}

function rowElement(container: HTMLElement, rowKey: string): HTMLElement {
  const row = container.querySelector(`[data-row-id="${id(rowKey)}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row ${rowKey}`);
  return row;
}

describe("withTreeColumn", () => {
  it("adds expansion gestures and keeps edit gestures", () => {
    const TestEditor = () => null;
    const column = withTreeColumn({
      ...textColumn("name", "Name"),
      edit: { editor: TestEditor, startsOn: ["enter", "type"] },
    });
    expect(column.activation?.startsOn).toEqual(["enter", "space"]);
    expect(column.edit?.startsOn).toEqual(["enter", "type"]);
    const activation = treeExpansionActivation({ startsOn: ["space"] });
    expect(
      withTreeColumn(textColumn("name", "Name"), { activation }).activation,
    ).toBe(activation);
  });
});

describe("tree rendering", () => {
  it("renders one treegrid with a chevron only on rows with children", async () => {
    const { container } = await renderTree();
    const grid = container.querySelector(`[data-grid-path="${path}"]`);
    expect(grid?.getAttribute("role")).toBe("treegrid");
    expect(
      container.querySelectorAll('[data-grid-part="header"]'),
    ).toHaveLength(1);

    const assets = rowElement(container, "1");
    const checking = rowElement(container, "2");
    const chevron = assets.querySelector('[data-grid-part="tree-chevron"]');
    expect(chevron?.getAttribute("aria-label")).toBe("Collapse row");
    expect(
      checking.querySelector('[data-grid-part="tree-chevron"]'),
    ).toBeNull();
    expect(
      checking.querySelector('[data-grid-part="tree-placeholder"]'),
    ).not.toBeNull();
    const indent = checking.querySelector('[data-grid-part="tree-cell"]');
    expect(indent?.getAttribute("data-tree-depth")).toBe("1");
    expect(
      (indent as HTMLElement).style.getPropertyValue("--grid-tree-depth"),
    ).toBe("1");
  });

  it("draws a footer row at top level without a chevron", async () => {
    const { container } = await renderTree("tabular", [
      { rowKey: "total", columns: { name: "Total" } },
    ]);
    const footer = container.querySelector(
      `[data-row-id="${makeLevelRowId(path, "footer", "total")}"]`,
    );
    if (!(footer instanceof HTMLElement)) throw new Error("no footer row");
    expect(footer.querySelector('[data-grid-part="tree-chevron"]')).toBeNull();
    expect(
      footer
        .querySelector('[data-grid-part="tree-cell"]')
        ?.getAttribute("data-tree-depth"),
    ).toBe("0");
  });

  it("describes the tree to assistive technology", async () => {
    const { container } = await renderTree();
    const assets = rowElement(container, "1");
    expect(assets.getAttribute("aria-level")).toBe("1");
    expect(assets.getAttribute("aria-expanded")).toBe("true");
    expect(assets.getAttribute("aria-posinset")).toBe("1");
    expect(assets.getAttribute("aria-setsize")).toBe("2");
    const savings = rowElement(container, "3");
    expect(savings.getAttribute("aria-level")).toBe("2");
    expect(savings.hasAttribute("aria-expanded")).toBe(false);
    expect(savings.getAttribute("aria-posinset")).toBe("2");
    expect(savings.getAttribute("data-tree-depth")).toBe("1");
  });

  it("collapses from the chevron", async () => {
    const { container, runtime } = await renderTree();
    const chevron = rowElement(container, "1").querySelector(
      '[data-grid-part="tree-chevron"]',
    );
    if (!(chevron instanceof HTMLButtonElement)) {
      throw new Error("expected a chevron button");
    }
    await act(async () => {
      chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(runtime.root.tree?.isExpanded(id("1"))).toBe(false);
    expect(container.querySelector(`[data-row-id="${id("2")}"]`)).toBeNull();
    const assets = rowElement(container, "1");
    expect(assets.getAttribute("aria-expanded")).toBe("false");
    expect(
      assets
        .querySelector('[data-grid-part="tree-chevron"]')
        ?.getAttribute("aria-label"),
    ).toBe("Expand row");
  });

  it("keeps tree order and indentation in cards", async () => {
    const { container } = await renderTree("cards");
    const rows = Array.from(
      container.querySelectorAll('[data-grid-part="row"]'),
    ).map((row) => row.getAttribute("data-row-id"));
    expect(rows).toEqual([id("1"), id("2"), id("3"), id("4")]);
    expect(
      rowElement(container, "2")
        .querySelector('[data-grid-part="tree-cell"]')
        ?.getAttribute("data-tree-depth"),
    ).toBe("1");
  });
});
