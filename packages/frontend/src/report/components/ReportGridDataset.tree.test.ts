// @vitest-environment happy-dom

import {
  act,
  cloneElement,
  createElement,
  isValidElement,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GridDataset,
  GridDatasetLevel,
} from "@sapporta/shared/grid-dataset";
import {
  ReportGridDataset,
  type ReportCellLinkContext,
  type ReportCellLinkResolvers,
  type ReportRowLinkContext,
} from "./ReportGridDataset";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout, so the width-observing hook would measure 0 and
// flip every test into the narrow cards mode. Pin the mode per test instead.
const { pageModeState } = vi.hoisted(() => ({
  pageModeState: { mode: "wide" as "wide" | "narrowCards" },
}));

vi.mock("../../table/page/table-page-mode", () => ({
  useTablePageMode: () => ({
    ref: { current: null },
    mode: pageModeState.mode,
  }),
}));

// The menu primitives render inline and forward the trigger's right-click,
// so a test can open the menu and read its items.
vi.mock("@sapporta/ui/context-menu", async () => {
  const { createElement: h } =
    await vi.importActual<typeof import("react")>("react");
  type TriggerProps = {
    children: ReactNode;
    onContextMenu?: (
      event: MouseEvent & { preventBaseUIHandler: () => void },
    ) => void;
    render?: ReactElement<HTMLAttributes<HTMLDivElement>>;
  };
  type ItemProps = {
    children: ReactNode;
    render?: ReactElement<HTMLAttributes<HTMLElement>>;
  };
  return {
    ContextMenu: ({ children }: { children: ReactNode }) =>
      h("div", null, children),
    ContextMenuTrigger: ({ children, onContextMenu, render }: TriggerProps) => {
      const handler = (event: MouseEvent) =>
        onContextMenu?.(Object.assign(event, { preventBaseUIHandler() {} }));
      return isValidElement(render)
        ? cloneElement(render, { onContextMenu: handler }, children)
        : h("div", { onContextMenu: handler }, children);
    },
    ContextMenuContent: ({ children }: { children: ReactNode }) =>
      h("div", { "data-menu": true }, children),
    ContextMenuItem: ({ children, render }: ItemProps) =>
      isValidElement(render)
        ? cloneElement(render, {}, children)
        : h("button", { type: "button" }, children),
    ContextMenuSeparator: () => h("hr"),
  };
});

// Expenses 600
//   Office 400
//     Rent 300
//     Supplies 100
//   Travel 200
const EXPENSE_ACCOUNTS = [
  { id: 1, parentId: null, name: "Expenses", amount: 600 },
  { id: 2, parentId: 1, name: "Office", amount: 400 },
  { id: 3, parentId: 2, name: "Rent", amount: 300 },
  { id: 4, parentId: 2, name: "Supplies", amount: 100 },
  { id: 5, parentId: 1, name: "Travel", amount: 200 },
];

function accountLevel(level: Partial<GridDatasetLevel> = {}): GridDatasetLevel {
  return {
    label: "Accounts",
    columns: [
      {
        id: "account_id",
        label: "Account ID",
        kind: "number",
        visuallyHidden: true,
      },
      {
        id: "parent_id",
        label: "Parent ID",
        kind: "number",
        visuallyHidden: true,
      },
      { id: "name", label: "Account", kind: "text" },
      {
        id: "amount",
        label: "Amount",
        kind: "number",
        displayFormat: "currency",
      },
    ],
    childLevels: [],
    tree: { parentColumn: "parent_id" },
    ...level,
  };
}

// Row keys are the account ids as strings; `parent_id` holds the parent's id
// as a number, which the tree compares with row keys as a string.
function accountNodes(): GridDataset["nodes"] {
  return EXPENSE_ACCOUNTS.map((account) => ({
    rowKey: String(account.id),
    levelName: "account",
    columns: {
      account_id: account.id,
      parent_id: account.parentId,
      name: account.name,
      amount: account.amount,
    },
  }));
}

function expenseDataset(level: Partial<GridDatasetLevel> = {}): GridDataset {
  return {
    name: "expense-breakdown",
    label: "Expense Breakdown",
    rootLevel: "account",
    levels: { account: accountLevel(level) },
    nodes: accountNodes(),
    footerRows: [
      {
        rowKey: "total-expenses",
        columns: { name: "Total Expenses", amount: 600 },
      },
    ],
  };
}

describe("ReportGridDataset tree levels", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    pageModeState.mode = "wide";
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    window.localStorage.clear();
  });

  async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };
    await act(async () => {
      root.render(element);
    });
    return container;
  }

  async function waitForText(
    container: HTMLElement,
    text: string,
  ): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      if (container.textContent?.includes(text)) return;
    }
    throw new Error(
      `Expected rendered text "${text}", got "${container.textContent}"`,
    );
  }

  function nameCells(container: HTMLElement): HTMLElement[] {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[data-grid-part="cell"][data-col-id="name"]',
      ),
    ];
  }

  /** The name column's text, in displayed order, footer rows included. */
  function displayedNames(container: HTMLElement): string[] {
    return nameCells(container).map((cell) => cell.textContent?.trim() ?? "");
  }

  function nameCell(container: HTMLElement, name: string): HTMLElement {
    const cell = nameCells(container).find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!cell) throw new Error(`Expected a name cell for "${name}"`);
    return cell;
  }

  function treeDepth(cell: HTMLElement): string | null {
    return (
      cell
        .querySelector('[data-grid-part="tree-cell"]')
        ?.getAttribute("data-tree-depth") ?? null
    );
  }

  function chevron(cell: HTMLElement): HTMLButtonElement {
    const button = cell.querySelector('[data-grid-part="tree-chevron"]');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Expected a tree chevron in "${cell.textContent}"`);
    }
    return button;
  }

  function gridRootFor(element: Element): HTMLElement {
    const root = element.closest("[data-grid-path]");
    if (!(root instanceof HTMLElement)) throw new Error("Expected grid root");
    return root;
  }

  async function click(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
  }

  async function mouseDown(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
  }

  async function keyDown(element: Element, key: string): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      );
    });
  }

  it("shows a tree level's rows as one tree under one header", async () => {
    const container = await render(
      createElement(ReportGridDataset, { dataset: expenseDataset() }),
    );
    await waitForText(container, "Total Expenses");

    expect(container.querySelectorAll("[data-grid-path]")).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-grid-part="header-cell"]'),
    ).toHaveLength(2);
    expect(displayedNames(container)).toEqual([
      "Expenses",
      "Office",
      "Rent",
      "Supplies",
      "Travel",
      "Total Expenses",
    ]);
    expect(
      ["Expenses", "Office", "Rent", "Supplies", "Travel"].map((name) =>
        treeDepth(nameCell(container, name)),
      ),
    ).toEqual(["0", "1", "2", "2", "1"]);

    expect(
      chevron(nameCell(container, "Expenses")).getAttribute("aria-label"),
    ).toBe("Collapse row");
    expect(
      chevron(nameCell(container, "Office")).getAttribute("aria-label"),
    ).toBe("Collapse row");
    for (const leaf of ["Rent", "Supplies", "Travel", "Total Expenses"]) {
      const cell = nameCell(container, leaf);
      expect(cell.querySelector('[data-grid-part="tree-chevron"]')).toBeNull();
    }
    // The tree column draws the only expand control.
    expect(
      container.querySelector('[data-grid-part="expand-cell"]'),
    ).toBeNull();
  });

  it("starts every tree row collapsed when the level is defaultCollapsed", async () => {
    const container = await render(
      createElement(ReportGridDataset, {
        dataset: expenseDataset({ defaultCollapsed: true }),
      }),
    );
    await waitForText(container, "Total Expenses");

    expect(displayedNames(container)).toEqual(["Expenses", "Total Expenses"]);
    await click(chevron(nameCell(container, "Expenses")));
    expect(displayedNames(container)).toEqual([
      "Expenses",
      "Office",
      "Travel",
      "Total Expenses",
    ]);
  });

  it("sorts siblings at every depth and keeps footer rows last", async () => {
    const container = await render(
      createElement(ReportGridDataset, { dataset: expenseDataset() }),
    );
    await waitForText(container, "Total Expenses");
    const amountHeader = container.querySelector(
      '[data-grid-part="header-cell"][data-col-id="amount"]',
    );
    if (!(amountHeader instanceof HTMLElement)) {
      throw new Error("Expected the Amount header");
    }

    await click(amountHeader);
    expect(amountHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(displayedNames(container)).toEqual([
      "Expenses",
      "Travel",
      "Office",
      "Supplies",
      "Rent",
      "Total Expenses",
    ]);

    await click(amountHeader);
    expect(amountHeader.getAttribute("aria-sort")).toBe("descending");
    expect(displayedNames(container)).toEqual([
      "Expenses",
      "Office",
      "Rent",
      "Supplies",
      "Travel",
      "Total Expenses",
    ]);
  });

  it("opens a tree row's link with Enter and toggles the row with Space or the chevron", async () => {
    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open ledger",
              href: `/reports/ledger?account=${node.columns.account_id}`,
              target: "_blank",
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const container = await render(
        createElement(ReportGridDataset, {
          dataset: expenseDataset(),
          links,
        }),
      );
      await waitForText(container, "Rent");
      expect(
        nameCell(container, "Rent")
          .querySelector('a[data-grid-part="report-primary-link"]')
          ?.getAttribute("href"),
      ).toBe("/reports/ledger?account=3");
      // The footer row is not an account and resolves no link.
      expect(
        nameCell(container, "Total Expenses").querySelector("a"),
      ).toBeNull();

      const office = nameCell(container, "Office");
      await mouseDown(office);
      await keyDown(gridRootFor(office), "Enter");
      expect(open).toHaveBeenCalledWith(
        "/reports/ledger?account=2",
        "_blank",
        "noopener,noreferrer",
      );
      expect(displayedNames(container)).toContain("Rent");

      await keyDown(gridRootFor(office), " ");
      expect(displayedNames(container)).not.toContain("Rent");

      await click(chevron(nameCell(container, "Office")));
      expect(displayedNames(container)).toContain("Rent");
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
    }
  });

  it("offers a tree row's cell and row links in its context menu", async () => {
    const cellContexts: ReportCellLinkContext[] = [];
    const rowContexts: ReportRowLinkContext[] = [];
    const links = {
      account: {
        cell: {
          name: (context) => {
            cellContexts.push(context);
            return [
              {
                label: "Open ledger",
                href: `/reports/ledger?account=${context.node.columns.account_id}`,
              },
              {
                label: "Open account",
                href: `/tables/accounts/${context.node.columns.account_id}`,
              },
            ];
          },
        },
        row: (context) => {
          rowContexts.push(context);
          return [
            {
              label: "Budget",
              href: `/reports/budget?account=${context.node.columns.account_id}`,
            },
          ];
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await render(
      createElement(ReportGridDataset, { dataset: expenseDataset(), links }),
    );
    await waitForText(container, "Rent");

    await act(async () => {
      nameCell(container, "Rent").dispatchEvent(
        new window.MouseEvent("contextmenu", { bubbles: true }),
      );
    });
    const menuLinks = [
      ...container.querySelectorAll('[data-grid-part="link-menu-item"]'),
    ].map((item) => item.getAttribute("href"));
    expect(menuLinks).toEqual([
      "/reports/ledger?account=3",
      "/tables/accounts/3",
      "/reports/budget?account=3",
    ]);

    // Tree parents are rows of the same level, so they are not ancestors.
    const rentCell = cellContexts.find(
      (context) => context.node.rowKey === "3",
    );
    expect(rentCell?.ancestors).toEqual([]);
    expect(rowContexts.at(-1)?.node.rowKey).toBe("3");
    expect(rowContexts.at(-1)?.ancestors).toEqual([]);
  });

  it("nests a tree level under an expanded row of another level", async () => {
    const dataset = {
      name: "income-statement",
      label: "Income Statement",
      rootLevel: "section",
      levels: {
        section: {
          columns: [{ id: "name", label: "Section", kind: "text" }],
          childLevels: ["account"],
        },
        account: accountLevel(),
      },
      nodes: [
        {
          rowKey: "income",
          levelName: "section",
          columns: { name: "Income" },
          children: {
            account: [
              {
                rowKey: "10",
                levelName: "account",
                columns: {
                  account_id: 10,
                  parent_id: null,
                  name: "Sales",
                  amount: 1000,
                },
              },
            ],
          },
        },
        {
          rowKey: "expenses",
          levelName: "section",
          columns: { name: "Expenses" },
          children: { account: accountNodes() },
          childFooterRows: {
            account: [
              {
                rowKey: "total-expenses",
                columns: { name: "Total Expenses", amount: 600 },
              },
            ],
          },
        },
      ],
      footerRows: [
        { rowKey: "net-income", columns: { name: "Net Income", amount: 400 } },
      ],
    } satisfies GridDataset;

    const cellContexts: ReportCellLinkContext[] = [];
    const links = {
      account: {
        cell: {
          name: (context) => {
            cellContexts.push(context);
            return [];
          },
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await render(
      createElement(ReportGridDataset, { dataset, links }),
    );
    await waitForText(container, "Rent");

    const expensesGrid = container.querySelector(
      '[data-grid-path="section.expenses.account"]',
    );
    if (!(expensesGrid instanceof HTMLElement)) {
      throw new Error("Expected the Expenses account grid");
    }
    expect(
      [
        ...expensesGrid.querySelectorAll<HTMLElement>(
          '[data-grid-part="cell"][data-col-id="name"]',
        ),
      ].map((cell) => [cell.textContent?.trim(), treeDepth(cell)]),
    ).toEqual([
      ["Expenses", "0"],
      ["Office", "1"],
      ["Rent", "2"],
      ["Supplies", "2"],
      ["Travel", "1"],
      ["Total Expenses", "0"],
    ]);
    expect(container.textContent).toContain("Net Income");

    // Ancestors are the rows of enclosing levels, not tree parents.
    const rent = cellContexts.find((context) => context.node.rowKey === "3");
    expect(rent?.ancestors.map((node) => node.rowKey)).toEqual(["expenses"]);
  });

  it("shows the hierarchy in the declared tree column", async () => {
    const dataset = expenseDataset({
      columns: [
        ...accountLevel().columns.slice(0, 2),
        { id: "code", label: "Code", kind: "text" },
        ...accountLevel().columns.slice(2),
      ],
      tree: { parentColumn: "parent_id", column: "name" },
    });
    dataset.nodes = dataset.nodes.map((node) => ({
      ...node,
      columns: { ...node.columns, code: `C-${node.rowKey}` },
    }));

    const container = await render(
      createElement(ReportGridDataset, { dataset }),
    );
    await waitForText(container, "Rent");

    expect(treeDepth(nameCell(container, "Rent"))).toBe("2");
    expect(
      container.querySelector(
        '[data-grid-part="cell"][data-col-id="code"] [data-grid-part="tree-cell"]',
      ),
    ).toBeNull();
  });

  it("shows tree rows as cards titled and indented by the tree column", async () => {
    pageModeState.mode = "narrowCards";
    const dataset = expenseDataset({
      columns: [
        { id: "code", label: "Code", kind: "text" },
        ...accountLevel().columns,
      ],
      tree: { parentColumn: "parent_id", column: "name" },
    });

    const container = await render(
      createElement(ReportGridDataset, { dataset }),
    );
    await waitForText(container, "Rent");

    const rootGrid = container.querySelector("[data-grid-path]");
    expect(rootGrid?.getAttribute("data-grid-presentation")).toBe("cards");
    const titles = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-grid-part="row-field"][data-card-role="title"]',
      ),
    ];
    expect(titles.every((title) => title.dataset.colId === "name")).toBe(true);
    const rentTitle = titles.find((title) =>
      title.textContent?.includes("Rent"),
    );
    if (!rentTitle) throw new Error("Expected a card titled Rent");
    expect(treeDepth(rentTitle)).toBe("2");

    await click(chevron(nameCell(container, "Office")));
    expect(container.textContent).not.toContain("Rent");
  });

  it("fails loudly when a tree level also declares child levels", async () => {
    const dataset = expenseDataset({ childLevels: ["entry"] });
    dataset.levels.entry = {
      columns: [{ id: "memo", label: "Memo", kind: "text" }],
      childLevels: [],
    };

    await expect(
      render(createElement(ReportGridDataset, { dataset })),
    ).rejects.toThrow(
      'Dataset "expense-breakdown": tree level "account" cannot also declare ' +
        "child levels (entry)",
    );
  });
});
