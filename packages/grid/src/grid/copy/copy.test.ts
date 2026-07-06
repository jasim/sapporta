// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  createGridRuntime,
  type GridRuntime,
} from "../runtime/create-grid-runtime";
import { inMemoryGridDataSource } from "../data-sources/memory/in-memory-grid-source";
import {
  childPath,
  makeRowId,
  rootPath,
  type ColId,
  type GridPath,
  type RowId,
} from "../types/identity";
import type { ColumnSchema, GridSchema } from "../types/schema";
import type { TreeNode } from "../types/level-row";
import {
  CELL_GRID_WITH_ACTIVE_ROW,
  ROW_MULTISELECT_LIST,
  type GridInteractionConfig,
} from "../types/interaction";
import { makeSelection } from "../types/selection";
import {
  gridCellIdentityAttrs,
  gridRootIdentityAttrs,
  gridRowIdentityAttrs,
} from "../react/internal/dom-targets";
import {
  serializeGridCopyTargetToCsv,
} from "./index";
import { prepareGridCopyTarget } from "./target";

const root = rootPath("accounts");
const cashId = makeRowId(root, "cash");
const revenueId = makeRowId(root, "revenue");

const columns: ColumnSchema[] = [
  column("account", "Account"),
  column("debit", "Debit"),
  column("credit", "Credit"),
  column("note", "Note"),
];

const schema: GridSchema = {
  rootLevel: "accounts",
  levels: {
    accounts: {
      name: "accounts",
      columns,
      options: { rowKey: (node, localIdx) => node.rowKey ?? String(localIdx) },
      childLevels: ["entries"],
    },
    entries: {
      name: "entries",
      columns: [column("description", "Description"), column("amount", "Amount")],
      options: { rowKey: (node, localIdx) => node.rowKey ?? String(localIdx) },
      childLevels: [],
    },
  },
};

const tree: TreeNode[] = [
  {
    rowKey: "cash",
    levelName: "accounts",
    columns: {
      account: "Cash",
      debit: 125,
      credit: null,
      note: `bank, "main"`,
    },
    children: {
      entries: [
        {
          rowKey: "entry-1",
          levelName: "entries",
          columns: { description: "Opening balance", amount: 125 },
        },
      ],
    },
  },
  {
    rowKey: "revenue",
    levelName: "accounts",
    columns: {
      account: "Revenue",
      debit: 0,
      credit: 125,
      note: "line 1\nline 2",
    },
  },
];

const runtimes: GridRuntime[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.dispose();
  }
  document.body.replaceChildren();
});

describe("serializeGridCopyTargetToCsv", () => {
  it("serializes a single cell", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: makeSelection({ rowId: cashId, colId: "account" }),
        },
        { includeHeaders: false },
      ),
    ).toBe("Cash");
  });

  it("serializes a multi-cell range in visible order", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: cashId, colId: "account" },
            head: { rowId: revenueId, colId: "debit" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBe("Cash,125\nRevenue,0");
  });

  it("prepends selected visible column headers", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: cashId, colId: "account" },
            head: { rowId: revenueId, colId: "debit" },
          },
        },
        { includeHeaders: true },
      ),
    ).toBe("Account,Debit\nCash,125\nRevenue,0");
  });

  it("normalizes reversed row ranges", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: revenueId, colId: "account" },
            head: { rowId: cashId, colId: "account" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBe("Cash\nRevenue");
  });

  it("normalizes reversed column ranges", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: cashId, colId: "debit" },
            head: { rowId: cashId, colId: "account" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBe("Cash,125");
  });

  it("normalizes reversed row and column ranges together", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: revenueId, colId: "debit" },
            head: { rowId: cashId, colId: "account" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBe("Cash,125\nRevenue,0");
  });

  it("returns null for stale row or column endpoints", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: makeRowId(root, "missing"), colId: "account" },
            head: { rowId: cashId, colId: "account" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBeNull();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: cashId, colId: "account" },
            head: { rowId: revenueId, colId: "missing" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBeNull();
  });

  it("escapes raw grid values as valid CSV", () => {
    const runtime = makeRuntime();

    expect(
      serializeGridCopyTargetToCsv(
        runtime,
        {
          path: root,
          selection: {
            anchor: { rowId: cashId, colId: "note" },
            head: { rowId: revenueId, colId: "note" },
          },
        },
        { includeHeaders: false },
      ),
    ).toBe(`"bank, ""main"""\n"line 1\nline 2"`);
  });
});

describe("prepareGridCopyTarget", () => {
  it("preserves the selected range when right-clicking inside it", () => {
    const runtime = makeRuntime();
    runtime.cursorManager.setCellRange(
      root,
      { rowId: cashId, colId: "account" },
      { rowId: revenueId, colId: "debit" },
    );
    const before = runtime.cursorManager.currentCellCursor();

    const target = prepareGridCopyTarget(
      runtime,
      renderCellTarget(root, cashId, "account").content,
    );

    expect(target).toEqual({
      path: root,
      selection: {
        anchor: { rowId: cashId, colId: "account" },
        head: { rowId: revenueId, colId: "debit" },
      },
    });
    expect(runtime.cursorManager.currentCellCursor()).toEqual(before);
  });

  it("replaces the target with a single cell when right-clicking outside the selected range", () => {
    const runtime = makeRuntime();
    runtime.cursorManager.setCellRange(
      root,
      { rowId: cashId, colId: "account" },
      { rowId: revenueId, colId: "debit" },
    );

    const target = prepareGridCopyTarget(
      runtime,
      renderCellTarget(root, revenueId, "note").content,
    );

    expect(target).toEqual({
      path: root,
      selection: makeSelection({ rowId: revenueId, colId: "note" }),
    });
    expect(runtime.cursorManager.currentCellCursor()).toEqual({
      path: root,
      rowId: revenueId,
      colId: "note",
    });
    expect(runtime.controllerFor(root).getState().cellSelection).toBeNull();
  });

  it("uses the active cell when the context menu opens outside a cell", () => {
    const runtime = makeRuntime();
    runtime.cursorManager.moveCellCursorTo({
      path: root,
      rowId: cashId,
      colId: "account",
    });

    expect(prepareGridCopyTarget(runtime, document.createElement("div"))).toEqual(
      {
        path: root,
        selection: makeSelection({ rowId: cashId, colId: "account" }),
      },
    );
  });

  it("returns no target when there is no active cell", () => {
    const runtime = makeRuntime();

    expect(
      prepareGridCopyTarget(runtime, document.createElement("div")),
    ).toBeNull();
  });

  it("keeps selections scoped to the clicked child path", () => {
    const runtime = makeRuntime();
    runtime.coordinator.expand(root, cashId);
    const entriesPath = childPath(root, "cash", "entries");
    const entryId = makeRowId(entriesPath, "entry-1");
    runtime.cursorManager.setCellRange(
      root,
      { rowId: cashId, colId: "account" },
      { rowId: revenueId, colId: "debit" },
    );
    runtime.cursorManager.setCellRange(
      entriesPath,
      { rowId: entryId, colId: "description" },
      { rowId: entryId, colId: "amount" },
    );

    const target = prepareGridCopyTarget(
      runtime,
      renderCellTarget(entriesPath, entryId, "description").content,
    );

    expect(target).toEqual({
      path: entriesPath,
      selection: {
        anchor: { rowId: entryId, colId: "description" },
        head: { rowId: entryId, colId: "amount" },
      },
    });
    expect(
      target
        ? serializeGridCopyTargetToCsv(runtime, target, {
            includeHeaders: false,
          })
        : null,
    ).toBe("Opening balance,125");
  });

  it("does not synthesize cell targets for row-list runtimes", () => {
    const runtime = makeRuntime(ROW_MULTISELECT_LIST);

    expect(
      prepareGridCopyTarget(
        runtime,
        renderCellTarget(root, cashId, "account").content,
      ),
    ).toBeNull();
  });
});

function column(id: ColId, name: string): ColumnSchema {
  return {
    id,
    name,
    renderCell: ({ value }) => String(value ?? ""),
  };
}

function makeRuntime(
  interaction: GridInteractionConfig = CELL_GRID_WITH_ACTIVE_ROW,
): GridRuntime {
  const runtime = createGridRuntime({
    schema,
    dataSource: inMemoryGridDataSource({
      schema,
      tree,
      levels: {
        accounts: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
        entries: {
          sortMode: "none",
          filterMode: "none",
          paginationMode: "none",
        },
      },
    }),
    interaction,
  });
  runtimes.push(runtime);
  return runtime;
}

function renderCellTarget(path: GridPath, rowId: RowId, colId: ColId): {
  content: HTMLElement;
} {
  const rootElement = document.createElement("div");
  applyAttrs(rootElement, gridRootIdentityAttrs(path));

  const rowElement = document.createElement("div");
  applyAttrs(rowElement, gridRowIdentityAttrs(rowId));

  const cellElement = document.createElement("div");
  applyAttrs(cellElement, gridCellIdentityAttrs(colId));

  const content = document.createElement("span");
  cellElement.append(content);
  rowElement.append(cellElement);
  rootElement.append(rowElement);
  document.body.append(rootElement);

  return { content };
}

function applyAttrs(
  element: HTMLElement,
  attrs: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
}
