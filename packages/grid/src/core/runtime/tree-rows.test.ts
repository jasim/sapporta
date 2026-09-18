import { describe, expect, it, vi } from "vitest";
import { createGridRuntime, runtimeInternalsFor } from "./runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import type { InMemoryLevelOpts } from "../data-sources/memory/in-memory-grid-source";
import type {
  GridDataSource,
  LevelDataSource,
  LevelSnapshot,
} from "../data-sources/types";
import {
  makeLevelRowId,
  makeRowId,
  rootPath,
  rowKeyOfRowId,
} from "../types/identity";
import type { LevelRow, TreeNode } from "../types/level-row";
import type { GridSchema, LevelSchema } from "../types/schema";
import type { RowPredicate } from "../pipeline/types";
import {
  CELL_EDITING_GRID,
  CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
  ROW_PRIMARY_MASTER_DETAIL,
  type GridInteractionConfig,
} from "../types/interaction";

const TestEditor = () => null;
const path = rootPath("accounts");
const id = (key: string) => makeRowId(path, key);

function account(rowKey: string, parent: number | null, name: string) {
  return {
    rowKey,
    levelName: "accounts",
    columns: { id: Number(rowKey), name, parent_id: parent },
  } satisfies TreeNode;
}

// Assets(1) > Checking(2), Savings(3); Expenses(4) > Taxes(5) > Federal(6);
// Income(7).
const accounts: TreeNode[] = [
  account("1", null, "Assets"),
  account("2", 1, "Checking"),
  account("3", 1, "Savings"),
  account("4", null, "Expenses"),
  account("5", 4, "Taxes"),
  account("6", 5, "Federal"),
  account("7", null, "Income"),
];

function accountsLevel(overrides: Partial<LevelSchema> = {}): LevelSchema {
  return {
    name: "accounts",
    rowHeaderColumn: "none",
    columns: [
      {
        id: "name",
        name: "Name",
        renderCell: ({ value }) => String(value ?? ""),
        compare: (a, b) => String(a).localeCompare(String(b)),
        edit: { editor: TestEditor, startsOn: ["enter", "type"] },
      },
      {
        id: "parent_id",
        name: "Parent",
        renderCell: ({ value }) => String(value ?? ""),
      },
    ],
    options: { allowPhantoms: true },
    childLevels: [],
    tree: { parentKeyField: "parent_id" },
    ...overrides,
  };
}

function schemaWith(level: LevelSchema = accountsLevel()): GridSchema {
  return { rootLevel: "accounts", levels: { accounts: level } };
}

const nameFilter = (filter: string | undefined): RowPredicate | undefined =>
  filter === undefined
    ? undefined
    : (columns) => String(columns.name).toLowerCase().includes(filter);

function createTreeRuntime(
  options: {
    level?: LevelSchema;
    nodes?: readonly TreeNode[];
    interaction?: GridInteractionConfig;
    levelOpts?: Partial<InMemoryLevelOpts<string>>;
    onObserverError?: (error: unknown) => void;
  } = {},
) {
  const schema = schemaWith(options.level);
  return createGridRuntime({
    schema,
    interaction: options.interaction ?? CELL_EDITING_GRID,
    onObserverError: options.onObserverError,
    dataSource: inMemoryGridDataSource<string>({
      schema,
      tree: options.nodes ?? accounts,
      levels: {
        accounts: {
          sortMode: "client",
          filterMode: "client",
          compileFilter: nameFilter,
          paginationMode: "none",
          ...options.levelOpts,
        },
      },
    }),
  });
}

function displayedKeys(rows: readonly LevelRow[]): string[] {
  return rows.map((row) =>
    row.kind === "data" ? row.source.rowKey : `${row.kind}:${row.id}`,
  );
}

function treeOf(runtime: ReturnType<typeof createTreeRuntime>) {
  const tree = runtime.root.tree;
  if (!tree) throw new Error("expected a tree level");
  return tree;
}

function key(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe("tree levels", () => {
  it("renders every row expanded by default, depth-first", () => {
    const rt = createTreeRuntime();
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    const federal = rt.root.displayedRow(id("6"));
    expect(federal?.kind === "data" && federal.tree).toMatchObject({
      depth: 2,
      parentId: id("5"),
    });
    expect(treeOf(rt).isExpanded(id("4"))).toBe(true);
    expect(treeOf(rt).isExpanded(id("7"))).toBe(false);
    expect(treeOf(rt).parentOf(id("6"))).toBe(id("5"));
    expect(treeOf(rt).childrenOf(id("1"))).toEqual([id("2"), id("3")]);
  });

  it("gives levels without `tree` no tree API", () => {
    const rt = createTreeRuntime({
      level: accountsLevel({ tree: undefined }),
    });
    expect(rt.root.tree).toBeNull();
    const row = rt.root.displayedRow(id("2"));
    expect(row?.kind === "data" && row.tree).toBeUndefined();
  });

  it("collapses and expands a row", () => {
    const rt = createTreeRuntime();
    const tree = treeOf(rt);
    tree.collapse(id("4"));
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "7",
    ]);
    expect(tree.isExpanded(id("4"))).toBe(false);
    tree.toggle(id("4"));
    expect(tree.isExpanded(id("4"))).toBe(true);
    expect(rt.root.displayedRows().rows).toHaveLength(7);
    // A leaf has nothing to expand or collapse.
    tree.collapse(id("7"));
    expect(tree.isExpanded(id("7"))).toBe(false);
  });

  it("starts collapsed when the level asks for it, and expands with toggles", () => {
    const rt = createTreeRuntime({
      level: accountsLevel({
        tree: { parentKeyField: "parent_id", defaultExpanded: false },
      }),
    });
    const tree = treeOf(rt);
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "4",
      "7",
    ]);
    tree.expand(id("4"));
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "4",
      "5",
      "7",
    ]);
    tree.reveal(id("6"));
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "4",
      "5",
      "6",
      "7",
    ]);
  });

  it("expands and collapses everything, including rows that load later", async () => {
    const rt = createTreeRuntime();
    const tree = treeOf(rt);
    tree.collapse(id("1"));
    tree.expandAll();
    expect(rt.root.displayedRows().rows).toHaveLength(7);
    tree.collapseAll();
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "4",
      "7",
    ]);
    await rt.root.createRow(account("8", 7, "Salary"));
    // Income gained a child; it follows the collapsed default.
    expect(tree.isExpanded(id("7"))).toBe(false);
    expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
      "1",
      "4",
      "7",
    ]);
    tree.expandAll();
    expect(displayedKeys(rt.root.displayedRows().rows)).toContain("8");
  });

  it("announces expansion changes to subscribers and host events", () => {
    const rt = createTreeRuntime();
    const listener = vi.fn();
    const events = vi.fn();
    treeOf(rt).subscribe(listener);
    rt.on("treeExpansionChanged", events);
    treeOf(rt).collapse(id("1"));
    treeOf(rt).collapseAll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(events.mock.calls.map(([event]) => event)).toEqual([
      { path, rowId: id("1"), expanded: false },
      { path, rowId: null, expanded: false },
    ]);
  });

  it("wakes only the rows whose tree facts changed", () => {
    const rt = createTreeRuntime();
    const assets = vi.fn();
    const checking = vi.fn();
    const expenses = vi.fn();
    rt.root.subscribeDisplayedRow(id("1"), assets);
    rt.root.subscribeDisplayedRow(id("2"), checking);
    rt.root.subscribeDisplayedRow(id("4"), expenses);
    const expensesBefore = rt.root.displayedRow(id("4"));
    treeOf(rt).collapse(id("1"));
    expect(assets).toHaveBeenCalledTimes(1);
    // Checking left the displayed rows.
    expect(checking).toHaveBeenCalledTimes(1);
    expect(expenses).not.toHaveBeenCalled();
    expect(rt.root.displayedRow(id("4"))).toBe(expensesBefore);
  });

  it("moves a cell cursor out of a collapsed subtree and clamps its range", () => {
    const rt = createTreeRuntime({
      interaction: CELL_EDITING_GRID,
    });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.setCellRange(
      path,
      { rowId: id("1"), colId: "name" },
      { rowId: id("6"), colId: "parent_id" },
    );
    treeOf(rt).collapse(id("4"));
    expect(internals.cursorManager.currentCellCursor()).toEqual({
      path,
      rowId: id("4"),
      colId: "parent_id",
    });
    expect(internals.controllerFor(path).getState().cellSelection).toEqual({
      anchor: { rowId: id("1"), colId: "name" },
      head: { rowId: id("4"), colId: "parent_id" },
    });
  });

  it("moves a row cursor to the collapsed ancestor", () => {
    const rt = createTreeRuntime({ interaction: ROW_PRIMARY_MASTER_DETAIL });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveRowCursorTo({ path, rowId: id("6") });
    treeOf(rt).collapseAll();
    expect(internals.cursorManager.currentRowCursor()).toEqual({
      path,
      rowId: id("4"),
    });
  });

  it("drops hidden rows from row selection", () => {
    const rt = createTreeRuntime({
      interaction: CELL_GRID_WITH_INDEPENDENT_ROW_SELECTION,
    });
    rt.root.setRowSelection({
      kind: "set",
      rowIds: new Set([id("2"), id("7")]),
    });
    treeOf(rt).collapse(id("1"));
    expect(rt.root.selectedRowIds()).toEqual([id("7")]);
  });

  describe("row-list keyboard", () => {
    function rowListRuntime() {
      const rt = createTreeRuntime({ interaction: ROW_PRIMARY_MASTER_DETAIL });
      const internals = runtimeInternalsFor(rt);
      const controller = internals.controllerFor(path);
      const cursor = () => internals.cursorManager.currentRowCursor()?.rowId;
      const press = (name: string) =>
        controller.handleKey(key(name), "tabular");
      const focus = (rowKey: string) =>
        internals.cursorManager.moveRowCursorTo({ path, rowId: id(rowKey) });
      return { rt, press, focus, cursor };
    }

    it("expands a collapsed parent on Right, then moves to its first child", () => {
      const { rt, press, focus, cursor } = rowListRuntime();
      treeOf(rt).collapse(id("4"));
      focus("4");
      press("ArrowRight");
      expect(treeOf(rt).isExpanded(id("4"))).toBe(true);
      expect(cursor()).toBe(id("4"));
      press("ArrowRight");
      expect(cursor()).toBe(id("5"));
    });

    it("collapses an expanded parent on Left, then moves to its parent", () => {
      const { rt, press, focus, cursor } = rowListRuntime();
      focus("5");
      press("ArrowLeft");
      expect(treeOf(rt).isExpanded(id("5"))).toBe(false);
      expect(cursor()).toBe(id("5"));
      press("ArrowLeft");
      expect(cursor()).toBe(id("4"));
      // A leaf moves to its parent too.
      focus("2");
      press("ArrowLeft");
      expect(cursor()).toBe(id("1"));
    });

    it("toggles a parent on Space and ignores Right and Space on a leaf", () => {
      const { rt, press, focus, cursor } = rowListRuntime();
      focus("1");
      press(" ");
      expect(treeOf(rt).isExpanded(id("1"))).toBe(false);
      press(" ");
      expect(treeOf(rt).isExpanded(id("1"))).toBe(true);
      focus("7");
      press("ArrowRight");
      press(" ");
      expect(cursor()).toBe(id("7"));
    });
  });

  it("toggles the tree column with Space in a cell grid", () => {
    const level = accountsLevel();
    const rt = createTreeRuntime({
      level: {
        ...level,
        columns: level.columns.map((column) =>
          column.id === "name"
            ? {
                ...column,
                activation: {
                  startsOn: ["enter", "space"],
                  describe: "Toggle",
                  run: ({ path: at, row, actions }) =>
                    actions.treeExpansion.toggle({ path: at, rowId: row.id }),
                },
              }
            : column,
        ),
      },
    });
    const internals = runtimeInternalsFor(rt);
    internals.cursorManager.moveCellCursorTo({
      path,
      rowId: id("4"),
      colId: "name",
    });
    internals.controllerFor(path).handleKey(key(" "), "tabular");
    expect(treeOf(rt).isExpanded(id("4"))).toBe(false);
    // Enter still edits the writable tree column.
    internals.controllerFor(path).handleKey(key("Enter"), "tabular");
    expect(internals.controllerFor(path).getState().editing?.coord).toEqual({
      rowId: id("4"),
      colId: "name",
    });
  });

  describe("drafts", () => {
    it("adds a child draft under its parent's last descendant and expands the parent", () => {
      const rt = createTreeRuntime();
      const tree = treeOf(rt);
      tree.collapse(id("4"));
      const draftId = tree.addChild(id("4"));
      expect(tree.isExpanded(id("4"))).toBe(true);
      expect(rowKeyOfRowId(draftId)).toBe("draft-1");
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        `phantom:${draftId}`,
        "7",
      ]);
      const draft = rt.root.displayedRow(draftId);
      expect(draft?.kind === "phantom" && draft.tree).toMatchObject({
        depth: 1,
        parentId: id("4"),
      });
      expect(rt.root.drafts.get()[0].columns).toEqual({ parent_id: "4" });
    });

    it("gives a leaf its first child and lets the caller type the parent key", () => {
      const rt = createTreeRuntime();
      const draftId = treeOf(rt).addChild(id("7"), { parent_id: 7 });
      expect(treeOf(rt).isExpanded(id("7"))).toBe(true);
      expect(treeOf(rt).parentOf(draftId)).toBe(id("7"));
      expect(rt.root.drafts.get()[0].columns).toEqual({ parent_id: 7 });
    });

    it("writes the parent key as the level types it, for a hidden parent too", () => {
      const rt = createTreeRuntime({
        level: accountsLevel({
          tree: {
            parentKeyField: "parent_id",
            parentKeyValue: (parent) => parent.columns.id,
          },
        }),
      });
      const tree = treeOf(rt);
      tree.collapse(id("4"));
      const draftId = tree.addChild(id("5"));
      expect(rt.root.drafts.get()[0].columns).toEqual({ parent_id: 5 });
      expect(tree.parentOf(draftId)).toBe(id("5"));
    });

    it("rejects a typed parent key that names another row", () => {
      const rt = createTreeRuntime({
        level: accountsLevel({
          tree: { parentKeyField: "parent_id", parentKeyValue: () => 99 },
        }),
      });
      expect(() => treeOf(rt).addChild(id("7"))).toThrow(
        /parentKeyValue returned 99 for row "7"/,
      );
      expect(rt.root.drafts.get()).toEqual([]);
    });

    it("commits the parent key with the new row", async () => {
      const rt = createTreeRuntime();
      const inserted = vi.fn();
      rt.on("mutationCommitted", inserted);
      const draftId = treeOf(rt).addChild(id("7"), { parent_id: 7 });
      const draftKey = rowKeyOfRowId(draftId);
      rt.root.drafts.setCell(draftKey, "name", "Salary");
      await rt.root.drafts.commit(draftKey);
      expect(inserted.mock.calls[0][0]).toMatchObject({
        kind: "insert",
        node: { columns: { name: "Salary", parent_id: 7 } },
      });
      // The committed row stays under its parent.
      expect(treeOf(rt).childrenOf(id("7"))).toEqual([id(draftKey)]);
    });

    it("removes an untouched child draft when the cursor leaves it", () => {
      const rt = createTreeRuntime();
      const internals = runtimeInternalsFor(rt);
      const draftId = treeOf(rt).addChild(id("7"));
      internals.cursorManager.moveCellCursorTo({
        path,
        rowId: draftId,
        colId: "name",
      });
      internals.cursorManager.moveCellCursorTo({
        path,
        rowId: id("1"),
        colId: "name",
      });
      expect(rt.root.drafts.get()).toEqual([]);
      expect(treeOf(rt).isExpanded(id("7"))).toBe(false);
    });

    it("rejects a parent that is not a data row of the level", () => {
      const rt = createTreeRuntime();
      expect(() => treeOf(rt).addChild(id("99"))).toThrow(/no data row/);
    });
  });

  describe("source-driven expansion", () => {
    it("reveals the matches of a new filter result", async () => {
      const rt = createTreeRuntime();
      const tree = treeOf(rt);
      tree.collapse(id("4"));
      await rt.root.data.query!.filter!.set("federal");
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
        "4",
        "5",
        "6",
      ]);
      const expenses = rt.root.displayedRow(id("4"));
      expect(expenses?.kind === "data" && expenses.tree?.context).toBe(true);
      const federal = rt.root.displayedRow(id("6"));
      expect(federal?.kind === "data" && federal.tree?.context).toBe(false);
      // The user may collapse the context again.
      tree.collapse(id("4"));
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual(["4"]);
    });

    it("reveals a new result's matches when its ancestors are unchanged", async () => {
      const rt = createTreeRuntime({
        nodes: [...accounts, account("8", 5, "State")],
      });
      await rt.root.data.query!.filter!.set("federal");
      treeOf(rt).collapse(id("5"));
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual(["4", "5"]);
      // Expenses and Taxes are the context rows of both searches.
      await rt.root.data.query!.filter!.set("state");
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
        "4",
        "5",
        "8",
      ]);
      // A new sort of the same result keeps the user's collapse.
      treeOf(rt).collapse(id("5"));
      await rt.root.data.query!.sort!.set([
        { colId: "name", direction: "desc" },
      ]);
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual(["4", "5"]);
    });

    it("keeps a matching parent's subtree unless the level asks for ancestors only", async () => {
      const withSubtree = createTreeRuntime();
      await withSubtree.root.data.query!.filter!.set("taxes");
      expect(displayedKeys(withSubtree.root.displayedRows().rows)).toEqual([
        "4",
        "5",
        "6",
      ]);

      const ancestorsOnly = createTreeRuntime({
        levelOpts: { treeMatchContext: "ancestors" },
      });
      await ancestorsOnly.root.data.query!.filter!.set("taxes");
      expect(displayedKeys(ancestorsOnly.root.displayedRows().rows)).toEqual([
        "4",
        "5",
      ]);
    });

    it("sorts siblings at every depth", async () => {
      const rt = createTreeRuntime();
      await rt.root.data.query!.sort!.set([
        { colId: "name", direction: "desc" },
      ]);
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
        "7",
        "4",
        "5",
        "6",
        "1",
        "3",
        "2",
      ]);
    });

    it("prunes toggles for rows that left the snapshot", async () => {
      const rt = createTreeRuntime();
      treeOf(rt).collapse(id("1"));
      await rt.root.removeRow("1");
      // Checking and Savings lost their parent and show at top level.
      expect(treeOf(rt).parentOf(id("2"))).toBeNull();
      await rt.root.createRow(account("1", null, "Assets"));
      // Assets came back as a new row, so it follows the expanded default.
      expect(treeOf(rt).isExpanded(id("1"))).toBe(true);
      expect(treeOf(rt).childrenOf(id("1"))).toEqual([id("2"), id("3")]);
    });
  });

  describe("bad data", () => {
    it("shows a parent loop once and reports it once per snapshot", () => {
      const onObserverError = vi.fn();
      const rt = createTreeRuntime({
        nodes: [
          account("1", null, "Assets"),
          account("2", 3, "Loop A"),
          account("3", 2, "Loop B"),
        ],
        onObserverError,
      });
      expect(displayedKeys(rt.root.displayedRows().rows)).toEqual([
        "1",
        "2",
        "3",
      ]);
      treeOf(rt).collapse(id("2"));
      expect(onObserverError).toHaveBeenCalledTimes(1);
      expect(String(onObserverError.mock.calls[0][0])).toMatch(
        /rows "2" form a loop/,
      );
    });

    it("turns structural rows into a source error", () => {
      const rt = createTreeRuntime({
        nodes: [
          account("1", null, "Assets"),
          { ...account("2", null, "Total"), kind: "subtotal" },
        ],
      });
      const state = rt.root.data.state();
      expect(state.status).toBe("initialError");
      expect(state.status === "initialError" && state.error.message).toMatch(
        /cannot show "subtotal" rows/,
      );
    });
  });

  describe("schema validation", () => {
    it("rejects a tree level with child levels", () => {
      expect(() =>
        createTreeRuntime({ level: accountsLevel({ childLevels: ["x"] }) }),
      ).toThrow(/cannot also declare child levels/);
    });
  });

  it("marks context rows from a custom source", () => {
    const schema = schemaWith();
    const snapshot: LevelSnapshot = {
      nodes: accounts.slice(3, 6),
      treeContextRowKeys: ["4", "5"],
    };
    const source: LevelDataSource = {
      state: () => ({ status: "ready", snapshot }),
      subscribe: () => () => {},
      dispose: () => {},
    };
    const dataSource: GridDataSource = {
      rootSource: () => source,
      resolveChild: () => {
        throw new Error("no children");
      },
      dispose: () => {},
    };
    const rt = createGridRuntime({ schema, dataSource });
    const contexts = rt.root
      .displayedRows()
      .rows.map((row) => row.kind === "data" && row.tree?.context);
    expect(contexts).toEqual([true, true, false]);
    expect(makeLevelRowId(path, "data", "4")).toBe(id("4"));
  });
});
