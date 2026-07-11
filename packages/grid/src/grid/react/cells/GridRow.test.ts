// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { columnPreset } from "../../../column-preset";
import { inMemoryGridDataSource } from "../../data-sources/memory/in-memory-grid-source";
import {
  createGridRuntime,
  runtimeInternalsFor,
} from "../../runtime/runtime";
import {
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  ROW_MULTISELECT_LIST,
  type GridInteractionConfig,
} from "../../types/interaction";
import { childPath, makeRowId, rootPath } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";
import type {
  CellActivation,
  GridSchema,
  RowHeaderColumn,
} from "../../types/schema";
import { GridLevel } from "../GridLevel";
import { GridRuntimeProvider } from "../GridRuntimeProvider";
import { withRowExpansionColumn } from "./ExpandableCellFrame";
import { rowChromeStateFromInteractionStatus } from "./GridRow";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("rowChromeStateFromInteractionStatus", () => {
  it.each([
    ["idle", { active: false, selected: false }],
    ["selected", { active: false, selected: true }],
    ["cursor", { active: true, selected: false }],
    ["cursor-selected", { active: true, selected: true }],
  ] as const)("projects %s into orthogonal row chrome", (status, chrome) => {
    expect(rowChromeStateFromInteractionStatus(status)).toEqual(chrome);
  });
});

describe("withRowExpansionColumn", () => {
  it("uses a supplied activation while preserving edit gesture filtering", () => {
    const TestEditor = () => null;
    const activation = {
      startsOn: ["enter"],
      describe: "Open link",
      run: () => {},
    } satisfies CellActivation;

    const column = withRowExpansionColumn(
      {
        id: "name",
        name: "Name",
        renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
        edit: {
          editor: TestEditor,
          startsOn: ["enter", "f2", "type", "doubleClick"],
        },
      },
      { activation },
    );

    expect(column.activation).toBe(activation);
    expect(column.edit?.startsOn).toEqual(["f2", "type", "doubleClick"]);
  });
});

const testColumn = (id: string, name: string, meta?: unknown) => ({
  id,
  name,
  meta,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
});

const schema: GridSchema = {
  rootLevel: "quotes",
  levels: {
    quotes: {
      name: "quotes",
      rowHeaderColumn: "none",
      columns: [
        testColumn("id", "ID", { displayType: "pk" }),
        testColumn("book_id", "Book"),
        testColumn("author_id", "Author"),
        testColumn("text", "Text"),
      ],
      options: {},
      childLevels: [],
    },
  },
};

const expandableIdentifierSchema: GridSchema = {
  rootLevel: "quotes",
  levels: {
    quotes: {
      name: "quotes",
      rowHeaderColumn: "none",
      columns: [
        withRowExpansionColumn(
          columnPreset.identifier({
            id: "id",
            name: "ID",
            meta: { displayType: "pk" },
          }),
        ),
        testColumn("text", "Text"),
      ],
      options: {},
      childLevels: [],
    },
  },
};

const tree: TreeNode[] = [
  {
    rowKey: "q1",
    levelName: "quotes",
    columns: {
      id: "q1",
      book_id: "Moby Dick",
      author_id: "Herman Melville",
      text: "Call me Ishmael.",
    },
  },
  {
    rowKey: "q2",
    levelName: "quotes",
    columns: {
      id: "q2",
      book_id: "Middlemarch",
      author_id: "George Eliot",
      text: "It is never too late.",
    },
  },
];

const quoteOneId = makeRowId(rootPath("quotes"), "q1");
const quoteTwoId = makeRowId(rootPath("quotes"), "q2");
const orderOneId = makeRowId(rootPath("orders"), "o1");

async function render(element: ReactElement): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
}

async function unmount(root: Root, container: HTMLElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function createQuotesRuntime(interaction?: typeof ROW_MULTISELECT_LIST) {
  return createGridRuntime({
    schema,
    dataSource: inMemoryGridDataSource({
      schema,
      tree,
      levels: {
        quotes: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    interaction,
  });
}

function createExpandableIdentifierRuntime() {
  return createGridRuntime({
    schema: expandableIdentifierSchema,
    dataSource: inMemoryGridDataSource({
      schema: expandableIdentifierSchema,
      tree,
      levels: {
        quotes: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
  });
}

function createRowHeaderRuntime(
  rowHeaderColumn: RowHeaderColumn,
  interaction: GridInteractionConfig = CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
) {
  const rowHeaderSchema: GridSchema = {
    ...schema,
    levels: {
      quotes: {
        ...schema.levels.quotes,
        rowHeaderColumn,
      },
    },
  };
  return createGridRuntime({
    schema: rowHeaderSchema,
    dataSource: inMemoryGridDataSource({
      schema: rowHeaderSchema,
      tree,
      levels: {
        quotes: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    interaction,
  });
}

function createExpandableRowHeaderRuntime(rowHeaderColumn: RowHeaderColumn) {
  const expandableSchema: GridSchema = {
    rootLevel: "orders",
    levels: {
      orders: {
        name: "orders",
        columns: [
          withRowExpansionColumn(testColumn("id", "ID")),
          testColumn("customer", "Customer"),
        ],
        rowHeaderColumn,
        options: {},
        childLevels: ["lines"],
      },
      lines: {
        name: "lines",
        columns: [testColumn("id", "ID"), testColumn("sku", "SKU")],
        rowHeaderColumn: "empty-selectable-cell",
        options: {},
        childLevels: [],
      },
    },
  };
  const expandableTree: TreeNode[] = [
    {
      rowKey: "o1",
      levelName: "orders",
      columns: { id: "o1", customer: "Alice" },
      children: {
        lines: [
          {
            rowKey: "l1",
            levelName: "lines",
            columns: { id: "l1", sku: "SKU-1" },
          },
        ],
      },
    },
  ];
  return createGridRuntime({
    schema: expandableSchema,
    dataSource: inMemoryGridDataSource({
      schema: expandableSchema,
      tree: expandableTree,
      levels: {
        orders: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
        lines: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  });
}

describe("GridRow cards presentation", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  it("renders every visible column in schema order through grid cells", async () => {
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime: createQuotesRuntime(),
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          presentation: "cards",
        }),
      }),
    );

    const firstRow = mounted.container.querySelector('[data-grid-part="row"]');
    if (!(firstRow instanceof HTMLElement)) {
      throw new Error("expected first row");
    }
    const fields = [
      ...firstRow.querySelectorAll('[data-grid-part="row-field"]'),
    ];
    expect(fields.map((field) => field.getAttribute("data-col-id"))).toEqual([
      "id",
      "book_id",
      "author_id",
      "text",
    ]);
    expect(fields[0]?.getAttribute("data-display-type")).toBe("pk");
    expect(firstRow.querySelector('[data-grid-part="card-title"]')).toBeNull();
    expect(mounted.container.textContent).toContain("Call me Ishmael.");
    expect(
      mounted.container.querySelectorAll('[role="gridcell"]'),
    ).toHaveLength(8);
  });

  it("renders expandable identifier values inside the pk card field", async () => {
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime: createExpandableIdentifierRuntime(),
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          presentation: "cards",
        }),
      }),
    );

    const pkField = mounted.container.querySelector(
      `[data-row-id="${quoteOneId}"] [data-grid-part="row-field"][data-col-id="id"][data-display-type="pk"]`,
    );
    if (!(pkField instanceof HTMLElement)) {
      throw new Error("expected pk card field");
    }

    expect(
      pkField.querySelector('[data-grid-part="expand-cell"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      pkField.querySelector('[data-grid-part="expand-content"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      pkField
        .querySelector('[data-grid-part="expand-content"]')
        ?.textContent?.trim(),
    ).toBe("q1");
    const expandCell = pkField.querySelector('[data-grid-part="expand-cell"]');
    const expandContent = pkField.querySelector(
      '[data-grid-part="expand-content"]',
    );
    const expandChevron = pkField.querySelector(
      '[data-grid-part="expand-chevron"]',
    );
    expect(expandCell?.firstElementChild).toBe(expandContent);
    expect(expandCell?.lastElementChild).toBe(expandChevron);
  });

  it("does not render tabular column headers in cards presentation", async () => {
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime: createQuotesRuntime(),
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          chrome: columnPreset.chrome(),
          presentation: "cards",
        }),
      }),
    );

    expect(
      mounted.container.querySelector('[data-grid-part="header-row"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-grid-part="row"]'),
    ).toBeInstanceOf(HTMLElement);
  });

  it("keeps cell focus behavior in cards presentation", async () => {
    const runtime = createQuotesRuntime();
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          presentation: "cards",
        }),
      }),
    );

    const textCell = mounted.container.querySelector(
      '[data-grid-part="cell"][data-col-id="text"]',
    );
    if (!(textCell instanceof HTMLElement)) {
      throw new Error("expected text cell");
    }

    await act(async () => {
      textCell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });

    expect(textCell.getAttribute("data-cell-status")).toBe("focus");
    expect(
      runtimeInternalsFor(runtime).coordinator.getState().cellCursor?.colId,
    ).toBe("text");
  });

  it("moves down through vertical fields and into the next row", async () => {
    const runtime = createQuotesRuntime();
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          presentation: "cards",
        }),
      }),
    );

    const firstTextCell = mounted.container.querySelector(
      `[data-row-id="${quoteOneId}"] [data-grid-part="cell"][data-col-id="text"]`,
    );
    const gridRoot = mounted.container.querySelector("[data-grid-path]");
    if (
      !(firstTextCell instanceof HTMLElement) ||
      !(gridRoot instanceof HTMLElement)
    ) {
      throw new Error("expected first text cell and grid root");
    }

    await act(async () => {
      firstTextCell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });

    await act(async () => {
      gridRoot.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });

    const cursor =
      runtimeInternalsFor(runtime).coordinator.getState().cellCursor;
    expect(cursor?.rowId).toContain("q2");
    expect(cursor?.colId).toBe("id");
  });

  it("keeps row-list focus behavior in cards presentation", async () => {
    const runtime = createQuotesRuntime(ROW_MULTISELECT_LIST);
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          presentation: "cards",
        }),
      }),
    );

    const textCell = mounted.container.querySelector(
      '[data-grid-part="cell"][data-col-id="text"]',
    );
    const row = mounted.container.querySelector('[data-grid-part="row"]');
    if (!(textCell instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error("expected text cell and row");
    }

    await act(async () => {
      textCell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });

    expect(row.getAttribute("data-row-active")).toBe("true");
    expect(
      runtimeInternalsFor(runtime).coordinator.getState().rowCursor?.rowId,
    ).toContain("q1");
  });
});

describe("GridRow row headers", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await unmount(mounted.root, mounted.container);
      mounted = null;
    }
  });

  async function renderRowHeaders(
    rowHeaderColumn: RowHeaderColumn,
    options: {
      presentation?: "tabular" | "cards";
      interaction?: GridInteractionConfig;
    } = {},
  ) {
    const runtime = createRowHeaderRuntime(
      rowHeaderColumn,
      options.interaction,
    );
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          chrome: columnPreset.chrome(),
          presentation: options.presentation ?? "tabular",
        }),
      }),
    );
    return runtime;
  }

  it("identifies a data-backed first cell as the row header without replacing its content", async () => {
    await renderRowHeaders({ column: "id" });

    const rowHeaders = mounted!.container.querySelectorAll(
      '[role="rowheader"][data-col-id="id"]',
    );
    expect(rowHeaders).toHaveLength(2);
    expect(rowHeaders[0]?.textContent).toBe("q1");
    expect(
      mounted!.container.querySelector('[data-grid-part="row-header-cell"]'),
    ).toBeNull();
    expect(
      mounted!.container
        .querySelector('[role="rowheader"][data-col-id="id"]')
        ?.getAttribute("data-row-header-kind"),
    ).toBe("column");
  });

  it("renders an empty structural handle and blank header outside data-column identity", async () => {
    await renderRowHeaders("empty-selectable-cell");

    const handles = mounted!.container.querySelectorAll(
      '[data-grid-part="row-header-cell"]',
    );
    expect(handles).toHaveLength(2);
    expect(handles[0]?.hasAttribute("data-col-id")).toBe(false);
    expect(
      handles[0]?.querySelector('[data-grid-part="row-header-control"]'),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      mounted!.container.querySelectorAll(
        '[data-grid-part="row-header-header-cell"]',
      ),
    ).toHaveLength(1);
    expect(
      mounted!.container.querySelectorAll('[data-grid-part="cell"]'),
    ).toHaveLength(8);
  });

  it("preserves the existing row and header DOM when row headers are disabled", async () => {
    await renderRowHeaders("none");

    expect(mounted!.container.querySelector('[role="rowheader"]')).toBeNull();
    expect(
      mounted!.container.querySelector(
        '[data-grid-part="row-header-header-cell"]',
      ),
    ).toBeNull();
    expect(
      mounted!.container.querySelectorAll('[role="gridcell"]'),
    ).toHaveLength(8);
  });

  it("hides row-header behavior in row-list interaction mode", async () => {
    const runtime = createRowHeaderRuntime(
      "empty-selectable-cell",
      ROW_MULTISELECT_LIST,
    );
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: rootPath("quotes"),
          chrome: columnPreset.chrome(),
        }),
      }),
    );

    expect(
      mounted.container.querySelector('[data-grid-part="row-header-cell"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector(
        '[data-grid-part="row-header-header-cell"]',
      ),
    ).toBeNull();
  });

  it("renders the empty handle as a leading card control rather than a row field", async () => {
    await renderRowHeaders("empty-selectable-cell", {
      presentation: "cards",
    });

    const firstRow = mounted!.container.querySelector(
      `[data-row-id="${quoteOneId}"]`,
    );
    const handle = firstRow?.querySelector(
      '[data-grid-part="row-header-cell"]',
    );
    expect(handle).toBeInstanceOf(HTMLElement);
    expect(handle?.closest('[data-grid-part="row-field"]')).toBeNull();
    expect(
      mounted!.container
        .querySelector('[data-grid-path="quotes"]')
        ?.getAttribute("data-row-header-kind"),
    ).toBe("empty-selectable-cell");
  });

  it("reuses row-selection gestures and clears row selection on ordinary cell click", async () => {
    const runtime = await renderRowHeaders({ column: "id" });
    const path = rootPath("quotes");
    const firstHeader = mounted!.container.querySelector(
      `[data-row-id="${quoteOneId}"] [role="rowheader"]`,
    );
    const secondHeader = mounted!.container.querySelector(
      `[data-row-id="${quoteTwoId}"] [role="rowheader"]`,
    );
    const dataCell = mounted!.container.querySelector(
      `[data-row-id="${quoteTwoId}"] [data-grid-part="cell"][data-col-id="text"]`,
    );
    if (
      !(firstHeader instanceof HTMLElement) ||
      !(secondHeader instanceof HTMLElement) ||
      !(dataCell instanceof HTMLElement)
    ) {
      throw new Error("expected row headers and data cell");
    }

    await act(async () => {
      firstHeader.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(runtime.level(path).selectedRowIds()).toHaveLength(1);

    await act(async () => {
      secondHeader.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          metaKey: true,
        }),
      );
    });
    expect(runtime.level(path).selectedRowIds()).toHaveLength(2);

    await act(async () => {
      firstHeader.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      secondHeader.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          shiftKey: true,
        }),
      );
    });
    expect(
      runtimeInternalsFor(runtime).controllerFor(path).getState().rowSelection
        ?.kind,
    ).toBe("range");
    expect(runtime.level(path).selectedRowIds()).toHaveLength(2);

    await act(async () => {
      dataCell.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(runtime.level(path).selectedRowIds()).toEqual([]);
    expect(
      runtimeInternalsFor(runtime).coordinator.getState().cellCursor?.colId,
    ).toBe("text");
  });

  it("supports Space and Escape on both data-backed and structural row headers", async () => {
    const dataRuntime = await renderRowHeaders({ column: "id" });
    const path = rootPath("quotes");
    const dataHeader = mounted!.container.querySelector(
      `[data-row-id="${quoteOneId}"] [role="rowheader"]`,
    );
    const gridRoot = mounted!.container.querySelector(
      '[data-grid-path="quotes"]',
    );
    if (
      !(dataHeader instanceof HTMLElement) ||
      !(gridRoot instanceof HTMLElement)
    ) {
      throw new Error("expected data row header and grid root");
    }
    await act(async () => {
      dataHeader.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      gridRoot.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: " " }),
      );
    });
    expect(dataRuntime.level(path).selectedRowIds()).toEqual([]);

    await unmount(mounted!.root, mounted!.container);
    mounted = null;
    const structuralRuntime = await renderRowHeaders("empty-selectable-cell");
    const control = mounted!.container.querySelector(
      `[data-row-id="${quoteOneId}"] [data-grid-part="row-header-control"]`,
    );
    if (!(control instanceof HTMLButtonElement)) {
      throw new Error("expected structural row-header control");
    }
    await act(async () => {
      control.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: " " }),
      );
    });
    expect(structuralRuntime.level(path).selectedRowIds()).toHaveLength(1);
    await act(async () => {
      control.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(structuralRuntime.level(path).selectedRowIds()).toEqual([]);
  });

  it("continues from a deleted structural selection and restores grid focus", async () => {
    const runtime = await renderRowHeaders("empty-selectable-cell");
    const path = rootPath("quotes");
    const firstControl = mounted!.container.querySelector(
      `[data-row-id="${quoteOneId}"] [data-grid-part="row-header-control"]`,
    );
    const gridRoot = mounted!.container.querySelector(
      '[data-grid-path="quotes"]',
    );
    if (
      !(firstControl instanceof HTMLButtonElement) ||
      !(gridRoot instanceof HTMLElement)
    ) {
      throw new Error("expected structural row control and grid root");
    }

    await act(async () => {
      firstControl.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
    const internals = runtimeInternalsFor(runtime);
    expect(internals.coordinator.getState().cellCursor).toBe(null);
    expect(internals.coordinator.getState().rowSelectionLead?.rowId).toContain(
      "q1",
    );

    const continuation = internals.planCursorContinuationForRowRemoval([
      { path, rowId: makeRowId(path, "q1") },
    ]);
    await act(async () => {
      internals.applyCursorContinuation(continuation);
      await runtime.level(path).removeRow("q1");
    });

    const nextCell = mounted!.container.querySelector(
      `[data-row-id="${quoteTwoId}"] [data-grid-part="cell"][data-col-id="id"]`,
    );
    expect(continuation).toEqual({
      kind: "cell",
      target: { path, rowId: makeRowId(path, "q2"), colId: "id" },
    });
    expect(nextCell?.getAttribute("data-cell-status")).toBe("focus");
    expect(document.activeElement).toBe(gridRoot);
  });

  it("preserves expansion for data-backed and structural row-header composition", async () => {
    const dataRuntime = createExpandableRowHeaderRuntime({ column: "id" });
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime: dataRuntime,
        children: createElement(GridLevel, {
          path: rootPath("orders"),
          chrome: columnPreset.chrome(),
        }),
      }),
    );
    const value = mounted.container.querySelector(
      '[role="rowheader"] [data-grid-part="expand-content"]',
    );
    const expandCell = value?.parentElement;
    const dataHeaderChevron = expandCell?.querySelector(
      '[data-grid-part="expand-chevron"]',
    );
    const root = mounted.container.querySelector('[data-grid-path="orders"]');
    if (
      !(value instanceof HTMLElement) ||
      !(dataHeaderChevron instanceof HTMLButtonElement) ||
      !(root instanceof HTMLElement)
    ) {
      throw new Error("expected expandable data row header");
    }
    expect(expandCell?.firstElementChild).toBe(value);
    expect(value.nextElementSibling).toBe(dataHeaderChevron);
    await act(async () => {
      value.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      value.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const orderRowId = makeRowId(rootPath("orders"), "o1");
    expect(dataRuntime.root.selectedRowIds()).toHaveLength(1);
    expect(dataRuntime.root.isExpanded(orderRowId)).toBe(false);

    await act(async () => {
      root.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(dataRuntime.root.isExpanded(orderRowId)).toBe(true);

    await unmount(mounted.root, mounted.container);
    mounted = null;
    const structuralRuntime = createExpandableRowHeaderRuntime(
      "empty-selectable-cell",
    );
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime: structuralRuntime,
        children: createElement(GridLevel, {
          path: rootPath("orders"),
          chrome: columnPreset.chrome(),
        }),
      }),
    );
    const firstRow = mounted.container.querySelector(
      `[data-row-id="${orderOneId}"]`,
    );
    const handle = firstRow?.querySelector(
      '[data-grid-part="row-header-cell"]',
    );
    const firstDataCell = firstRow?.querySelector(
      '[data-grid-part="cell"][data-col-id="id"]',
    );
    const chevron = firstDataCell?.querySelector("button");
    expect(firstRow?.firstElementChild).toBe(handle);
    expect(handle?.nextElementSibling).toBe(firstDataCell);
    if (!(chevron instanceof HTMLButtonElement)) {
      throw new Error("expected expansion chevron after structural handle");
    }
    await act(async () => {
      chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(structuralRuntime.root.isExpanded(orderRowId)).toBe(true);
    expect(structuralRuntime.root.selectedRowIds()).toEqual([]);
    expect(
      mounted.container.querySelector(
        '[data-grid-depth="1"] [data-grid-part="row-header-cell"]',
      ),
    ).toBeInstanceOf(HTMLElement);
  });

  it("plain and modified row-header clicks coordinate selection across paths", async () => {
    const runtime = createExpandableRowHeaderRuntime({ column: "id" });
    const ordersPath = rootPath("orders");
    const linesPath = childPath(ordersPath, "o1", "lines");
    mounted = await render(
      createElement(GridRuntimeProvider, {
        runtime,
        children: createElement(GridLevel, {
          path: ordersPath,
          chrome: columnPreset.chrome(),
        }),
      }),
    );
    const rootHeader = mounted.container.querySelector(
      `[data-row-id="${orderOneId}"] [role="rowheader"]`,
    );
    const root = mounted.container.querySelector('[data-grid-path="orders"]');
    if (
      !(rootHeader instanceof HTMLElement) ||
      !(root instanceof HTMLElement)
    ) {
      throw new Error("expected root row header");
    }
    await act(async () => {
      rootHeader.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      root.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    const childControl = mounted.container.querySelector(
      '[data-grid-depth="1"] [data-grid-part="row-header-control"]',
    );
    if (!(childControl instanceof HTMLButtonElement)) {
      throw new Error("expected child row-header control");
    }

    await act(async () => {
      childControl.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      );
    });
    expect(runtime.root.selectedRowIds()).toHaveLength(1);
    expect(runtime.level(linesPath).selectedRowIds()).toHaveLength(1);

    await act(async () => {
      childControl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(runtime.root.selectedRowIds()).toEqual([]);
    expect(runtime.level(linesPath).selectedRowIds()).toHaveLength(1);
  });
});
