import { describe, expect, it } from "vitest";
import { createGridRuntime, runtimeInternalsFor } from "../runtime/runtime";
import type {
  RuntimeKernel,
  LoadedRowsBoundaryEvent,
} from "../runtime/runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import type {
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
  SourceLoadResult,
} from "../data-sources/types";
import { childPath, makeRowId, rootPath } from "../types/identity";
import type { GridPath, RowId } from "../types/identity";
import type { FooterRow, TreeNode } from "../types/level-row";
import type { GridSchema } from "../types/schema";
import type { GridInteractionConfig } from "../types/interaction";
import {
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  ROW_MULTISELECT_LIST,
} from "../types/interaction";
import { withRowExpansionColumn } from "../react/cells/ExpandableCellFrame";

const TestEditor = () => null;
const testColumn = (id: string, name: string) => ({
  id,
  name,
  renderCell: ({ value }: { value: unknown }) => String(value ?? ""),
  edit: {
    editor: TestEditor,
    startsOn: ["enter", "type", "doubleClick"] as const,
  },
});

const reportSchema: GridSchema = {
  rootLevel: "cat",
  levels: {
    cat: {
      name: "cat",
      rowHeaderColumn: "none",
      columns: [
        withRowExpansionColumn(testColumn("name", "Name")),
        testColumn("qty", "Qty"),
      ],
      options: {},
      childLevels: ["items"],
    },
    items: {
      name: "items",
      rowHeaderColumn: "none",
      columns: [testColumn("name", "Name"), testColumn("qty", "Qty")],
      options: {},
      childLevels: [],
    },
  },
};

const root = rootPath("cat");
const fruitItems = childPath(root, "Fruit", "items");
const vegItems = childPath(root, "Veg", "items");

const tree: TreeNode[] = [
  {
    rowKey: "Fruit",
    levelName: "cat",
    columns: { name: "Fruit" },
    children: {
      items: [
        { rowKey: "Apple", levelName: "items", columns: { name: "Apple" } },
        {
          rowKey: "Banana",
          levelName: "items",
          columns: { name: "Banana" },
        },
      ],
    },
  },
  {
    rowKey: "Veg",
    levelName: "cat",
    columns: { name: "Veg" },
    children: {
      items: [
        { rowKey: "Carrot", levelName: "items", columns: { name: "Carrot" } },
      ],
    },
  },
];

const booksSchema: GridSchema = {
  rootLevel: "books",
  levels: {
    books: {
      name: "books",
      rowHeaderColumn: "none",
      columns: [
        withRowExpansionColumn(testColumn("title", "Title")),
        testColumn("author", "Author"),
      ],
      options: {},
      childLevels: ["quotes"],
    },
    quotes: {
      name: "quotes",
      rowHeaderColumn: "none",
      columns: [testColumn("text", "Quote")],
      options: {},
      childLevels: [],
    },
  },
};

const booksRoot = rootPath("books");
const duneQuotes = childPath(booksRoot, "book-2", "quotes");

const booksTree: TreeNode[] = [
  {
    rowKey: "book-1",
    levelName: "books",
    columns: { id: "book-1", title: "Kindred", author: "Octavia Butler" },
  },
  {
    rowKey: "book-2",
    levelName: "books",
    columns: { id: "book-2", title: "Dune", author: "Frank Herbert" },
    children: {
      quotes: [
        {
          rowKey: "quote-1",
          levelName: "quotes",
          columns: { id: "quote-1", text: "Fear is the mind-killer." },
        },
        {
          rowKey: "quote-2",
          levelName: "quotes",
          columns: { id: "quote-2", text: "The sleeper must awaken." },
        },
      ],
    },
  },
  {
    rowKey: "book-3",
    levelName: "books",
    columns: { id: "book-3", title: "Piranesi", author: "Susanna Clarke" },
  },
];

function setupExpanded(interaction?: GridInteractionConfig) {
  const rt = setupCollapsed(interaction);
  rt.coordinator.toggleExpand(root, makeRowId(root, "Fruit"));
  rt.coordinator.toggleExpand(root, makeRowId(root, "Veg"));
  return rt;
}

function setupCollapsed(interaction?: GridInteractionConfig) {
  const ds = inMemoryGridDataSource({
    schema: reportSchema,
    tree,
    levels: {
      cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      items: { sortMode: "none", filterMode: "none", paginationMode: "none" },
    },
  });
  return runtimeInternalsFor(
    createGridRuntime({
      schema: reportSchema,
      dataSource: ds,
      interaction,
    }),
  );
}

function setupRowList() {
  return runtimeInternalsFor(
    createGridRuntime({
      schema: reportSchema,
      dataSource: inMemoryGridDataSource({
        schema: reportSchema,
        tree,
        levels: {
          cat: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
          items: {
            sortMode: "none",
            filterMode: "none",
            paginationMode: "none",
          },
        },
      }),
      interaction: ROW_MULTISELECT_LIST,
    }),
  );
}

function setupPagedBooks() {
  let page = 0;
  const rootPages = [booksTree.slice(0, 2), booksTree.slice(2)];
  let rootSnapshot: LevelSnapshot = { nodes: rootPages[page] };
  const rootSubs = new Set<() => void>();
  const rootSource: LevelDataSource = {
    state: () => ({ status: "ready", snapshot: rootSnapshot }),
    subscribe: (fn) => {
      rootSubs.add(fn);
      return () => {
        rootSubs.delete(fn);
      };
    },
    dispose: () => {
      rootSubs.clear();
    },
  };
  const quotesSource: LevelDataSource = {
    state: () => ({
      status: "ready",
      snapshot: { nodes: booksTree[1].children!.quotes as TreeNode[] },
    }),
    subscribe: () => () => {},
    dispose: () => {},
  };
  const rt = runtimeInternalsFor(
    createGridRuntime({
      schema: booksSchema,
      dataSource: {
        rootSource: () => rootSource,
        resolveChild: () => quotesSource,
        dispose: () => {
          rootSource.dispose();
          quotesSource.dispose();
        },
      },
      onLoadedRowsBoundary: (event) => {
        if (event.loadPath !== booksRoot) {
          return false;
        }
        const nextPage = event.direction === "after" ? page + 1 : page - 1;
        if (nextPage < 0 || nextPage >= rootPages.length) {
          return Promise.resolve({
            kind: "unchanged" as const,
            state: rootSource.state(),
          });
        }
        page = nextPage;
        rootSnapshot = { nodes: rootPages[page] };
        for (const fn of rootSubs) fn();
        const state = rootSource.state();
        if (state.status !== "ready") {
          return Promise.resolve({ kind: "unchanged" as const, state });
        }
        return Promise.resolve({ kind: "ready" as const, state });
      },
    }),
  );
  rt.coordinator.toggleExpand(booksRoot, makeRowId(booksRoot, "book-2"));
  return rt;
}

function pagedRootDataSource(
  pages: TreeNode[][],
  footerRows?: FooterRow[],
  initialPage = 0,
): {
  dataSource: GridDataSource;
  onLoadedRowsBoundary: (
    event: LoadedRowsBoundaryEvent,
  ) => Promise<SourceLoadResult> | false;
} {
  let page = initialPage;
  const snapshotForPage = (): LevelSnapshot => {
    return {
      nodes: pages[page],
      ...(footerRows ? { footerRows } : {}),
    };
  };
  let snapshot: LevelSnapshot = snapshotForPage();
  const subscribers = new Set<() => void>();
  const publish = () => {
    snapshot = snapshotForPage();
    for (const subscriber of subscribers) subscriber();
  };
  const source: LevelDataSource = {
    state: () => ({ status: "ready", snapshot }),
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
    dispose: () => {
      subscribers.clear();
    },
  };
  return {
    dataSource: {
      rootSource: () => source,
      resolveChild: () => {
        throw new Error("not used");
      },
      dispose: source.dispose,
    },
    onLoadedRowsBoundary: (event) => {
      if (event.loadPath !== root) return false;
      const nextPage = event.direction === "after" ? page + 1 : page - 1;
      if (nextPage < 0 || nextPage >= pages.length) {
        return Promise.resolve({
          kind: "unchanged" as const,
          state: source.state(),
        });
      }
      page = nextPage;
      publish();
      return readyLoadResult(source.state());
    },
  };
}

function readyLoadResult(
  state: ReturnType<LevelDataSource["state"]>,
): Promise<SourceLoadResult> {
  if (state.status !== "ready") {
    return Promise.resolve({ kind: "unchanged", state });
  }
  return Promise.resolve({ kind: "ready", state });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function pagedRuntime(
  interaction?: GridInteractionConfig,
  footerRows?: FooterRow[],
  initialPage = 0,
) {
  return pagedRuntimeWithPages(
    [
      [{ rowKey: "Fruit", levelName: "cat", columns: { name: "Fruit" } }],
      [{ rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } }],
    ],
    interaction,
    footerRows,
    initialPage,
  );
}

function pagedRuntimeWithPages(
  pages: TreeNode[][],
  interaction?: GridInteractionConfig,
  footerRows?: FooterRow[],
  initialPage = 0,
) {
  const harness = pagedRootDataSource(pages, footerRows, initialPage);
  return runtimeInternalsFor(
    createGridRuntime({
      schema: reportSchema,
      dataSource: harness.dataSource,
      onLoadedRowsBoundary: harness.onLoadedRowsBoundary,
      interaction,
    }),
  );
}

function focusCell(
  rt: RuntimeKernel,
  path: GridPath,
  coord: { rowId: RowId; colId: "name" | "qty" },
) {
  rt.cursorManager.setCellRange(path, coord, coord);
}

describe("GridCoordinator", () => {
  it("cursorManager.apply sets the cursor", () => {
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.coordinator.getState().cellCursor?.path).toBe(root);
  });

  it("cursorManager.moveTo clears the remembered range", () => {
    const rt = setupExpanded();
    const anchor = {
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    const head = { rowId: makeRowId(root, "Fruit"), colId: "qty" as const };
    rt.cursorManager.setCellRange(root, anchor, head);

    rt.cursorManager.moveCellCursorTo({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });

    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
  });

  it("cell presses clear row selection across registered paths", () => {
    const rt = setupExpanded(CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION);
    rt.rowInteraction.selectRow(root, makeRowId(root, "Fruit"));
    rt.rowInteraction.selectRow(fruitItems, makeRowId(fruitItems, "Apple"));

    rt.coordinator.navigateCell(root, {
      type: "cellPressed",
      target: { rowId: makeRowId(root, "Veg"), colId: "qty" },
      extend: false,
    });

    expect(rt.selectedRowIds(root)).toEqual([]);
    expect(rt.selectedRowIds(fruitItems)).toEqual([]);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "qty",
    });
  });

  it("replacing row selection clears cell ranges and selections in other paths", () => {
    const rt = setupExpanded(CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION);
    rt.cursorManager.setCellRange(
      root,
      { rowId: makeRowId(root, "Fruit"), colId: "name" },
      { rowId: makeRowId(root, "Fruit"), colId: "qty" },
    );
    rt.cursorManager.setCellRange(
      fruitItems,
      { rowId: makeRowId(fruitItems, "Apple"), colId: "name" },
      { rowId: makeRowId(fruitItems, "Banana"), colId: "qty" },
    );
    rt.rowInteraction.selectRow(root, makeRowId(root, "Fruit"));
    rt.rowInteraction.selectRow(fruitItems, makeRowId(fruitItems, "Apple"));

    rt.coordinator.navigateCell(fruitItems, {
      type: "rowPressed",
      target: makeRowId(fruitItems, "Banana"),
      origin: {
        kind: "cell",
        target: { rowId: makeRowId(fruitItems, "Banana"), colId: "name" },
      },
      gesture: "replace",
    });

    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
    expect(rt.controllerFor(fruitItems).getState().cellSelection).toBe(null);
    expect(rt.selectedRowIds(root)).toEqual([]);
    expect(rt.selectedRowIds(fruitItems)).toEqual([
      makeRowId(fruitItems, "Banana"),
    ]);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
  });

  it("toggling a row control preserves other-path rows and clears cell focus", () => {
    const rt = setupExpanded(CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION);
    rt.cursorManager.setCellRange(
      root,
      { rowId: makeRowId(root, "Fruit"), colId: "name" },
      { rowId: makeRowId(root, "Fruit"), colId: "qty" },
    );
    rt.rowInteraction.selectRow(root, makeRowId(root, "Fruit"));

    rt.coordinator.navigateCell(fruitItems, {
      type: "rowPressed",
      target: makeRowId(fruitItems, "Apple"),
      origin: { kind: "row-control" },
      gesture: "toggle",
    });

    expect(rt.coordinator.getState().cellCursor).toBe(null);
    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
    expect(rt.selectedRowIds(root)).toEqual([makeRowId(root, "Fruit")]);
    expect(rt.selectedRowIds(fruitItems)).toEqual([
      makeRowId(fruitItems, "Apple"),
    ]);
  });

  it("Shift+Space row toggles clear cell ranges without moving cell focus", () => {
    const rt = setupExpanded(CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION);
    const anchor = { rowId: makeRowId(root, "Fruit"), colId: "name" as const };
    const head = { rowId: makeRowId(root, "Fruit"), colId: "qty" as const };
    rt.cursorManager.setCellRange(root, anchor, head);

    expect(
      rt.controllerFor(root).handleKey({
        key: " ",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);

    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      ...head,
    });
    expect(rt.selectedRowIds(root)).toEqual([makeRowId(root, "Fruit")]);
  });

  it("direct cursor moves update focus without requesting scroll", () => {
    const cellGrid = setupExpanded();
    const cellTarget = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };

    cellGrid.cursorManager.moveCellCursorTo(cellTarget);

    expect(cellGrid.coordinator.getState().cellCursor).toEqual(cellTarget);
    expect(cellGrid.controllerFor(root).getState().liveCellFocus).toEqual({
      rowId: cellTarget.rowId,
      colId: cellTarget.colId,
    });
    expect(
      cellGrid
        .controllerFor(root)
        .effects.getState()
        .map((e) => e.type),
    ).not.toContain("scrollFocusIntoView");

    const rowList = setupRowList();
    const rowTarget = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
    };

    rowList.cursorManager.moveRowCursorTo(rowTarget);

    expect(rowList.coordinator.getState().rowCursor).toEqual(rowTarget);
    expect(rowList.controllerFor(root).getState().liveRowFocus).toBe(
      rowTarget.rowId,
    );
    expect(
      rowList
        .controllerFor(root)
        .effects.getState()
        .map((e) => e.type),
    ).not.toContain("scrollRowIntoView");
  });

  it("keyboard navigation reveals the moved cursor", () => {
    const cellGrid = setupExpanded();
    const firstCell = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    cellGrid.cursorManager.moveCellCursorTo(firstCell);
    cellGrid.controllerFor(root).flushEffects();

    cellGrid.controllerFor(root).handleKey({
      key: "ArrowRight",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);

    expect(cellGrid.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: firstCell.rowId,
      colId: "qty",
    });
    expect(cellGrid.controllerFor(root).effects.getState()).toContainEqual({
      type: "scrollFocusIntoView",
      coord: { rowId: firstCell.rowId, colId: "qty" },
    });

    const rowList = setupRowList();
    const firstRow = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
    };
    const secondRowId = makeRowId(root, "Veg");
    rowList.cursorManager.moveRowCursorTo(firstRow);
    rowList.controllerFor(root).flushEffects();

    rowList.controllerFor(root).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);

    expect(rowList.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: secondRowId,
    });
    expect(rowList.controllerFor(root).effects.getState()).toContainEqual({
      type: "scrollRowIntoView",
      rowId: secondRowId,
    });
  });

  it("ArrowDown at the last loaded cell turns to the next page and focuses its first row", async () => {
    const rt = pagedRuntime();
    const first = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    rt.cursorManager.moveCellCursorTo(first);
    rt.controllerFor(root).flushEffects();

    rt.controllerFor(root).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    const second = makeRowId(root, "Veg");
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: second,
      colId: "name",
    });
    expect(rt.controllerFor(root).effects.getState()).toContainEqual({
      type: "scrollFocusIntoView",
      coord: { rowId: second, colId: "name" },
    });
  });

  it("ArrowUp at the first loaded cell turns to the previous page and focuses its last row", async () => {
    const rt = pagedRuntime(undefined, undefined, 1);
    const second = {
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name" as const,
    };
    rt.cursorManager.moveCellCursorTo(second);
    rt.controllerFor(root).flushEffects();

    rt.controllerFor(root).handleKey({
      key: "ArrowUp",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    const first = makeRowId(root, "Fruit");
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: first,
      colId: "name",
    });
  });

  it("ArrowDown from the last child row of the last root page row turns the root page", async () => {
    const rt = setupPagedBooks();
    expect(
      rt.displayedRowsFor(duneQuotes).rows.map((row) => row.columns.text),
    ).toEqual(["Fear is the mind-killer.", "The sleeper must awaken."]);

    rt.cursorManager.moveCellCursorTo({
      path: duneQuotes,
      rowId: makeRowId(duneQuotes, "quote-2"),
      colId: "text",
    });
    rt.controllerFor(duneQuotes).flushEffects();

    rt.controllerFor(duneQuotes).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: booksRoot,
      rowId: makeRowId(booksRoot, "book-3"),
      colId: "title",
    });
  });

  it("PageDown first clamps to the last loaded cell, then turns to the next page", async () => {
    const rt = pagedRuntimeWithPages([
      [
        { rowKey: "Fruit", levelName: "cat", columns: { name: "Fruit" } },
        { rowKey: "Apple", levelName: "cat", columns: { name: "Apple" } },
      ],
      [{ rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } }],
    ]);
    const first = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    rt.cursorManager.moveCellCursorTo(first);

    rt.controllerFor(root).handleKey({
      key: "PageDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Apple"),
      colId: "name",
    });

    rt.controllerFor(root).handleKey({
      key: "PageDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("PageUp first clamps to the first loaded cell, then turns to the previous page", async () => {
    const rt = pagedRuntimeWithPages(
      [
        [{ rowKey: "Fruit", levelName: "cat", columns: { name: "Fruit" } }],
        [
          { rowKey: "Apple", levelName: "cat", columns: { name: "Apple" } },
          { rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } },
        ],
      ],
      undefined,
      undefined,
      1,
    );
    rt.cursorManager.moveCellCursorTo({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });

    rt.controllerFor(root).handleKey({
      key: "PageUp",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Apple"),
      colId: "name",
    });

    rt.controllerFor(root).handleKey({
      key: "PageUp",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
  });

  it("ArrowDown from the last focusable row before a footer turns to the next page", async () => {
    const rt = pagedRuntime(undefined, [
      { rowKey: "total", columns: { name: "Total" } },
    ]);
    const first = {
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    rt.cursorManager.moveCellCursorTo(first);

    rt.controllerFor(root).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("row-list ArrowDown at the last loaded row turns to the next page", async () => {
    const rt = pagedRuntime(ROW_MULTISELECT_LIST);
    rt.cursorManager.moveRowCursorTo({
      path: root,
      rowId: makeRowId(root, "Fruit"),
    });
    rt.controllerFor(root).flushEffects();

    rt.controllerFor(root).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    const second = makeRowId(root, "Veg");
    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: second,
    });
    expect(rt.controllerFor(root).effects.getState()).toContainEqual({
      type: "scrollRowIntoView",
      rowId: second,
    });
  });

  it("row-list PageDown first clamps to the last loaded row, then turns to the next page", async () => {
    const rt = pagedRuntimeWithPages(
      [
        [
          { rowKey: "Fruit", levelName: "cat", columns: { name: "Fruit" } },
          { rowKey: "Apple", levelName: "cat", columns: { name: "Apple" } },
        ],
        [{ rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } }],
      ],
      ROW_MULTISELECT_LIST,
    );
    rt.cursorManager.moveRowCursorTo({
      path: root,
      rowId: makeRowId(root, "Fruit"),
    });

    rt.controllerFor(root).handleKey({
      key: "PageDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Apple"),
    });

    rt.controllerFor(root).handleKey({
      key: "PageDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
    });
  });

  it("row-list PageUp first clamps to the first loaded row, then turns to the previous page", async () => {
    const rt = pagedRuntimeWithPages(
      [
        [{ rowKey: "Fruit", levelName: "cat", columns: { name: "Fruit" } }],
        [
          { rowKey: "Apple", levelName: "cat", columns: { name: "Apple" } },
          { rowKey: "Veg", levelName: "cat", columns: { name: "Veg" } },
        ],
      ],
      ROW_MULTISELECT_LIST,
      undefined,
      1,
    );
    rt.cursorManager.moveRowCursorTo({
      path: root,
      rowId: makeRowId(root, "Veg"),
    });

    rt.controllerFor(root).handleKey({
      key: "PageUp",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Apple"),
    });

    rt.controllerFor(root).handleKey({
      key: "PageUp",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
    });
  });

  it("row-list ArrowDown from the last selectable row before a footer turns to the next page", async () => {
    const rt = pagedRuntime(ROW_MULTISELECT_LIST, [
      { rowKey: "total", columns: { name: "Total" } },
    ]);
    rt.cursorManager.moveRowCursorTo({
      path: root,
      rowId: makeRowId(root, "Fruit"),
    });

    rt.controllerFor(root).handleKey({
      key: "ArrowDown",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    await flushMicrotasks();

    expect(rt.coordinator.getState().rowCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
    });
  });

  it("cursorManager.moveTo clears remembered ranges across paths", () => {
    const rt = setupExpanded();
    rt.cursorManager.setCellRange(
      root,
      { rowId: makeRowId(root, "Fruit"), colId: "name" },
      { rowId: makeRowId(root, "Fruit"), colId: "qty" },
    );
    rt.cursorManager.setCellRange(
      fruitItems,
      { rowId: makeRowId(fruitItems, "Apple"), colId: "name" },
      { rowId: makeRowId(fruitItems, "Banana"), colId: "qty" },
    );

    rt.cursorManager.moveCellCursorTo({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });

    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
    expect(rt.controllerFor(fruitItems).getState().cellSelection).toBe(null);
  });

  it("horizontal arrow movement without shift clears the selected range", () => {
    const rt = setupExpanded();
    const anchor = {
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    const head = { rowId: makeRowId(root, "Fruit"), colId: "qty" as const };
    rt.cursorManager.setCellRange(root, anchor, head);
    expect(
      rt.controllerFor(root).handleKey({
        key: "ArrowLeft",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.controllerFor(root).getState().liveCellFocus).toEqual({
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);
  });

  it("Shift+Arrow starts a range anchored at the previously focused cell", () => {
    const rt = setupExpanded();
    const anchor = {
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    const head = {
      rowId: makeRowId(root, "Fruit"),
      colId: "qty" as const,
    };
    rt.cursorManager.moveCellCursorTo({ path: root, ...anchor });
    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);

    expect(
      rt.controllerFor(root).handleKey({
        key: "ArrowRight",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);

    expect(rt.controllerFor(root).getState().cellSelection).toEqual({
      anchor,
      head,
    });
  });

  it("Shift+click starts a range anchored at the previously focused cell", () => {
    const rt = setupExpanded();
    const anchor = {
      rowId: makeRowId(root, "Fruit"),
      colId: "name" as const,
    };
    const head = {
      rowId: makeRowId(root, "Veg"),
      colId: "qty" as const,
    };
    rt.cursorManager.moveCellCursorTo({ path: root, ...anchor });
    expect(rt.controllerFor(root).getState().cellSelection).toBe(null);

    rt.cursorManager.extendCellSelectionTo({ path: root, ...head });

    expect(rt.controllerFor(root).getState().cellSelection).toEqual({
      anchor,
      head,
    });
  });

  it("commit follow-up uses coordinator navigation", () => {
    const rt = setupExpanded();
    const coord = { rowId: makeRowId(root, "Fruit"), colId: "name" as const };
    focusCell(rt, root, coord);
    const controller = rt.controllerFor(root);
    controller.startEdit(coord, "doubleClick");
    controller.commitEdit("x", "next");
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "qty",
    });
    expect(controller.getState().liveCellFocus).toEqual({
      rowId: makeRowId(root, "Fruit"),
      colId: "qty",
    });
  });

  it("toggleExpand flips a row in the expansion set", () => {
    const ds = inMemoryGridDataSource({
      schema: reportSchema,
      tree,
      levels: {
        cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
        items: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      },
    });
    const rt = runtimeInternalsFor(
      createGridRuntime({ schema: reportSchema, dataSource: ds }),
    );
    const id = makeRowId(root, "Fruit");
    rt.coordinator.toggleExpand(root, id);
    expect(rt.coordinator.getState().expansion.get(root)?.has(id)).toBe(true);
    rt.coordinator.toggleExpand(root, id);
    expect(rt.coordinator.getState().expansion.get(root)).toBeUndefined();
  });

  it("expand and collapse are idempotent", () => {
    const ds = inMemoryGridDataSource({
      schema: reportSchema,
      tree,
      levels: {
        cat: { sortMode: "none", filterMode: "none", paginationMode: "none" },
        items: { sortMode: "none", filterMode: "none", paginationMode: "none" },
      },
    });
    const rt = runtimeInternalsFor(
      createGridRuntime({ schema: reportSchema, dataSource: ds }),
    );
    const id = makeRowId(root, "Fruit");

    rt.coordinator.expand(root, id);
    rt.coordinator.expand(root, id);
    expect(rt.coordinator.getState().expansion.get(root)?.has(id)).toBe(true);

    rt.coordinator.collapse(root, id);
    rt.coordinator.collapse(root, id);
    expect(rt.coordinator.getState().expansion.get(root)).toBeUndefined();
  });

  // The visible sequence interleaves children between their owning parent
  // rows. With Fruit and Veg both expanded:
  //   Fruit → Apple → Banana → Veg → Carrot
  // The navigation tests below assert that runtime traversal follows the same
  // sequence the user sees on screen.
  it("navigate down from last child row dispatches focus on the parent's next row", () => {
    const rt = setupExpanded();
    // Seed cursor on the source path so coordinator.navigate can
    // resolve a target relative to the current cursor.
    rt.cursorManager.applyCellCursor({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
    rt.coordinator.navigateCell(fruitItems, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
    expect(rt.controllerFor(root).getState().liveCellFocus).toEqual({
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("navigate up from first child row dispatches focus on its owning parent row", () => {
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
    rt.coordinator.navigateCell(fruitItems, {
      type: "moveRow",
      direction: "up",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.controllerFor(fruitItems).getState().liveCellFocus).toBe(null);
  });

  it("navigate up from a parent row dispatches focus on the previous expanded child's last row", () => {
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
    rt.coordinator.navigateCell(root, {
      type: "moveRow",
      direction: "up",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
  });

  it("navigate down from a parent row dispatches focus into its expanded child", () => {
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    rt.coordinator.navigateCell(root, {
      type: "moveRow",
      direction: "down",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
  });

  it("navigate to last from a parent row lands on the deepest expanded leaf", () => {
    // Ctrl+End across multiple expanded levels — the plan's headline
    // cross-level case. With Fruit + Veg both expanded:
    //   Fruit → Apple → Banana → Veg → Carrot
    // 'last' must walk to Carrot, not stop at Veg.
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    rt.coordinator.navigateCell(root, {
      type: "moveGridEdge",
      edge: "last",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: vegItems,
      rowId: makeRowId(vegItems, "Carrot"),
      colId: "name",
    });
  });

  it("navigate to first from a leaf returns to the root's first row", () => {
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: vegItems,
      rowId: makeRowId(vegItems, "Carrot"),
      colId: "name",
    });
    rt.coordinator.navigateCell(vegItems, {
      type: "moveGridEdge",
      edge: "first",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
  });

  it("navigate by row delta jumps across the cross-level visible sequence", () => {
    // Sequence with both expanded: Fruit, Apple, Banana, Veg, Carrot.
    // From Fruit (idx 0), +3 lands on Veg.
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    rt.coordinator.navigateCell(root, {
      type: "moveRowDelta",
      delta: 3,
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("navigate dispatches focus to a target controller before any DOM mounts", () => {
    // The target controller is created lazily by `controllerFor`, but that
    // is a pure-state object — it has no dependency on a Grid being
    // mounted. The focus dispatch sets cursor + liveCellFocus and queues
    // effects immediately; EffectRunner drains them whenever the target
    // Grid eventually mounts (controllers outlive DOM presence).
    const rt = setupExpanded();
    rt.cursorManager.applyCellCursor({
      path: vegItems,
      rowId: makeRowId(vegItems, "Carrot"),
      colId: "name",
    });
    rt.coordinator.navigateCell(vegItems, {
      type: "moveRow",
      direction: "up",
      colPolicy: "preserve",
      extend: false,
    });
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("handleKey ArrowDown from an expanded parent enters the first child row", () => {
    const rt = setupExpanded();
    focusCell(rt, root, {
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(
      rt.controllerFor(root).handleKey({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
    expect(rt.controllerFor(fruitItems).getState().liveCellFocus).toEqual({
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
  });

  it("uses Enter for edit and Space for expansion on an editable cell", () => {
    const rt = setupCollapsed();
    rt.cursorManager.applyCellCursor({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });

    expect(
      rt.controllerFor(root).handleKey({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.controllerFor(root).getState().editing).toMatchObject({
      coord: { rowId: makeRowId(root, "Fruit"), colId: "name" },
      editStart: { trigger: "enter" },
    });
    expect(rt.coordinator.getState().expansion.get(root)).toBeUndefined();
    rt.controllerFor(root).cancelEdit();

    expect(
      rt.controllerFor(root).handleKey({
        key: " ",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(
      rt.coordinator
        .getState()
        .expansion.get(root)
        ?.has(makeRowId(root, "Fruit")),
    ).toBe(true);
  });

  it("handleKey ArrowUp from a parent enters the previous expanded child's last row", () => {
    const rt = setupExpanded();
    focusCell(rt, root, {
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
    expect(
      rt.controllerFor(root).handleKey({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
  });

  it("handleKey ArrowDown from the last child lands on the next parent row", () => {
    const rt = setupExpanded();
    focusCell(rt, fruitItems, {
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "name",
    });
    expect(
      rt.controllerFor(fruitItems).handleKey({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
  });

  it("handleKey ArrowUp from the first child lands on the owning parent row", () => {
    const rt = setupExpanded();
    focusCell(rt, fruitItems, {
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
    expect(
      rt.controllerFor(fruitItems).handleKey({
        key: "ArrowUp",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
  });

  it("handleKey Tab from a parent row enters the expanded child row", () => {
    const rt = setupExpanded();
    focusCell(rt, root, {
      rowId: makeRowId(root, "Fruit"),
      colId: "qty",
    });
    expect(
      rt.controllerFor(root).handleKey({
        key: "Tab",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
  });

  it("handleKey Shift+Tab from a parent row enters the previous expanded child row", () => {
    const rt = setupExpanded();
    focusCell(rt, root, {
      rowId: makeRowId(root, "Veg"),
      colId: "name",
    });
    expect(
      rt.controllerFor(root).handleKey({
        key: "Tab",
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: fruitItems,
      rowId: makeRowId(fruitItems, "Banana"),
      colId: "qty",
    });
  });

  it("collapsing a row containing the cursor's subtree moves the cursor to the parent row", () => {
    const rt = setupExpanded();
    focusCell(rt, fruitItems, {
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
    rt.coordinator.toggleExpand(root, makeRowId(root, "Fruit"));
    expect(rt.coordinator.getState().cellCursor).toEqual({
      path: root,
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.controllerFor(fruitItems).getState().liveCellFocus).toBe(null);
  });

  it("cursorManager.setRange on a non-active path activates that path", () => {
    const rt = setupExpanded();
    focusCell(rt, root, {
      rowId: makeRowId(root, "Fruit"),
      colId: "name",
    });
    expect(rt.coordinator.getState().cellCursor?.path).toBe(root);
    focusCell(rt, fruitItems, {
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
    // The cursor moves to the new path; the prior path's liveCellFocus is
    // cleared. This is the regression the focus-management abstraction
    // prevents — a stale `selection.head` on the inactive path used to
    // short-circuit cross-path delivery and leave DOM focus on the
    // wrong grid.
    expect(rt.coordinator.getState().cellCursor?.path).toBe(fruitItems);
    expect(rt.controllerFor(root).getState().liveCellFocus).toBe(null);
    expect(rt.controllerFor(fruitItems).getState().liveCellFocus).toEqual({
      rowId: makeRowId(fruitItems, "Apple"),
      colId: "name",
    });
  });
});
