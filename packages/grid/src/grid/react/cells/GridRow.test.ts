// @vitest-environment happy-dom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { columnPreset } from "../../../column-preset";
import { inMemoryGridDataSource } from "../../data-sources/memory/in-memory-grid-source";
import { createGridRuntime } from "../../runtime/create-grid-runtime";
import { ROW_MULTISELECT_LIST } from "../../types/interaction";
import { rootPath } from "../../types/identity";
import type { TreeNode } from "../../types/level-row";
import type { GridSchema } from "../../types/schema";
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
      columns: [
        testColumn("id", "ID", { displayType: "pk" }),
        testColumn("book_id", "Book"),
        testColumn("author_id", "Author"),
        testColumn("text", "Text"),
      ],
      options: { rowKey: (node: TreeNode) => String(node.columns.id) },
      childLevels: [],
    },
  },
};

const expandableIdentifierSchema: GridSchema = {
  rootLevel: "quotes",
  levels: {
    quotes: {
      name: "quotes",
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
      options: { rowKey: (node: TreeNode) => String(node.columns.id) },
      childLevels: [],
    },
  },
};

const tree: TreeNode[] = [
  {
    levelName: "quotes",
    columns: {
      id: "q1",
      book_id: "Moby Dick",
      author_id: "Herman Melville",
      text: "Call me Ishmael.",
    },
  },
  {
    levelName: "quotes",
    columns: {
      id: "q2",
      book_id: "Middlemarch",
      author_id: "George Eliot",
      text: "It is never too late.",
    },
  },
];

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
      '[data-row-id="quotes#q1"] [data-grid-part="row-field"][data-col-id="id"][data-display-type="pk"]',
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
    expect(runtime.coordinator.getState().cellCursor?.colId).toBe("text");
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
      '[data-row-id="quotes#q1"] [data-grid-part="cell"][data-col-id="text"]',
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

    const cursor = runtime.coordinator.getState().cellCursor;
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
    expect(runtime.coordinator.getState().rowCursor?.rowId).toContain("q1");
  });
});
