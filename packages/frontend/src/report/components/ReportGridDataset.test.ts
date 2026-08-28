// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ReportGridDataset,
  type ReportCellLinkContext,
  type ReportCellLinkResolvers,
  type ReportCellRenderers,
} from "./ReportGridDataset";
import { CellTooltip } from "@sapporta/grid/column-preset";
import type { GridDataset } from "@sapporta/shared/grid-dataset";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReportGridDataset", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    window.localStorage.clear();
  });

  async function renderClient(
    element: ReactElement,
    options: { strict?: boolean } = {},
  ): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        options.strict ? createElement(StrictMode, null, element) : element,
      );
    });
    mounted = { root, container };
    return container;
  }

  async function rerenderClient(
    element: ReactElement,
    options: { strict?: boolean } = {},
  ): Promise<void> {
    await act(async () => {
      mounted?.root.render(
        options.strict ? createElement(StrictMode, null, element) : element,
      );
    });
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

  function hasDisposedRuntimeError(
    calls: Parameters<typeof console.error>[],
  ): boolean {
    return calls.some((call) =>
      call.some((arg) => String(arg).includes("GridRuntime has been disposed")),
    );
  }

  function replacementDataset(rowKey: string, account: string): GridDataset {
    return {
      name: `trial-balance-${rowKey}`,
      label: `Trial Balance ${rowKey}`,
      rootLevel: "account",
      levels: {
        account: {
          columns: [
            { id: "account", label: "Account", kind: "text" },
            { id: "debit", label: "Debit", kind: "number" },
          ],
          childLevels: [],
        },
      },
      nodes: [
        {
          rowKey,
          levelName: "account",
          columns: { account, debit: 125 },
        },
      ],
    };
  }

  function accountLedgerDataset(
    options: { defaultCollapsed?: boolean; includeSubtotal?: boolean } = {},
  ): GridDataset {
    const nodes: GridDataset["nodes"] = [
      {
        rowKey: "acct-1",
        levelName: "account",
        columns: { account_id: "acct-1", name: "Cash", debit: 125 },
        children: {
          entry: [
            {
              rowKey: "journal-1",
              levelName: "entry",
              columns: {
                journal_id: "journal-1",
                description: "Opening balance",
                amount: 125,
              },
            },
          ],
        },
      },
    ];

    if (options.includeSubtotal) {
      nodes.push({
        rowKey: "subtotal",
        levelName: "account",
        kind: "subtotal",
        columns: { account_id: "", name: "Total", debit: 125 },
      });
    }

    return {
      name: "account-ledger",
      label: "Account Ledger",
      rootLevel: "account",
      levels: {
        account: {
          columns: [
            {
              id: "account_id",
              label: "Account ID",
              kind: "text",
              visuallyHidden: true,
            },
            { id: "name", label: "Account", kind: "text" },
            { id: "debit", label: "Debit", kind: "number" },
          ],
          childLevels: ["entry"],
          defaultCollapsed: options.defaultCollapsed,
        },
        entry: {
          columns: [
            {
              id: "journal_id",
              label: "Journal ID",
              kind: "text",
              visuallyHidden: true,
            },
            { id: "description", label: "Description", kind: "text" },
            {
              id: "amount",
              label: "Amount",
              kind: "number",
              displayFormat: "currency",
            },
          ],
          childLevels: [],
        },
      },
      nodes,
    };
  }

  function cellByColumn(
    container: HTMLElement,
    columnId: string,
    text: string,
  ): HTMLElement {
    const cell = [
      ...container.querySelectorAll<HTMLElement>(
        `[data-grid-part="cell"][data-col-id="${columnId}"]`,
      ),
    ].find((candidate) => candidate.textContent?.includes(text));
    if (!cell) {
      throw new Error(`Expected ${columnId} cell containing "${text}"`);
    }
    return cell;
  }

  function gridRootFor(element: Element): HTMLElement {
    const root = element.closest("[data-grid-path]");
    if (!(root instanceof HTMLElement)) {
      throw new Error("Expected grid root");
    }
    return root;
  }

  async function mouseDown(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
  }

  async function click(element: Element): Promise<void> {
    await act(async () => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
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

  function dispatchPointer(
    target: Element,
    type: string,
    init: { clientX: number; pointerId: number },
  ): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      button: { value: 0 },
      clientX: { value: init.clientX },
      pointerId: { value: init.pointerId },
    });
    target.dispatchEvent(event);
  }

  it("resizes and persists columns independently for nested report levels", async () => {
    const dataset = accountLedgerDataset();
    const storageKey = "sapporta:report-grid-columns:account-ledger:entry";
    window.localStorage.clear();

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset }),
    );

    await waitForText(container, "Opening balance");
    const rootGrid = container.querySelector('[data-grid-path="account"]');
    const childGrid = container.querySelector(
      '[data-grid-path="account.acct-1.entry"]',
    );
    if (!(rootGrid instanceof HTMLElement)) {
      throw new Error("expected report root grid");
    }
    if (!(childGrid instanceof HTMLElement)) {
      throw new Error("expected nested report grid");
    }

    const resizeHandlesFor = (grid: HTMLElement) =>
      [
        ...grid.querySelectorAll('[data-grid-part="column-resize-handle"]'),
      ].filter((handle) => handle.closest("[data-grid-path]") === grid);

    expect(resizeHandlesFor(rootGrid)).toHaveLength(2);
    expect(resizeHandlesFor(childGrid)).toHaveLength(2);

    const header = childGrid.querySelector(
      '[data-grid-part="header-cell"][data-col-id="description"]',
    );
    const handle = header?.querySelector(
      '[data-grid-part="column-resize-handle"]',
    );
    if (!(header instanceof HTMLElement)) {
      throw new Error("expected Description header");
    }
    if (!(handle instanceof HTMLElement)) {
      throw new Error("expected Description resize handle");
    }
    Object.defineProperty(header, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          width: 120,
          height: 32,
          top: 0,
          right: 120,
          bottom: 32,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });

    await act(async () => {
      dispatchPointer(handle, "pointerdown", { clientX: 120, pointerId: 1 });
      dispatchPointer(handle, "pointermove", { clientX: 165, pointerId: 1 });
      dispatchPointer(handle, "pointerup", { clientX: 165, pointerId: 1 });
    });

    expect(
      childGrid.style.getPropertyValue("--grid-template-columns"),
    ).toContain("165px");
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      { description: 165 },
    );
    expect(
      window.localStorage.getItem(
        "sapporta:report-grid-columns:account-ledger:account",
      ),
    ).toBeNull();
  });

  it("renders nested rows with app-owned cell links", async () => {
    const dataset = {
      name: "account-ledger",
      label: "Account Ledger",
      rootLevel: "account",
      levels: {
        account: {
          columns: [
            {
              id: "account_id",
              label: "Account ID",
              kind: "text",
              visuallyHidden: true,
            },
            { id: "name", label: "Account", kind: "text" },
          ],
          childLevels: ["entry"],
        },
        entry: {
          columns: [
            {
              id: "journal_id",
              label: "Journal ID",
              kind: "text",
              visuallyHidden: true,
            },
            { id: "description", label: "Description", kind: "text" },
            {
              id: "amount",
              label: "Amount",
              kind: "number",
              displayFormat: "currency",
            },
          ],
          childLevels: [],
        },
      },
      nodes: [
        {
          rowKey: "acct-1",
          levelName: "account",
          columns: { account_id: "acct-1", name: "Cash" },
          children: {
            entry: [
              {
                rowKey: "journal-1",
                levelName: "entry",
                columns: {
                  journal_id: "journal-1",
                  description: "Opening balance",
                  amount: 125,
                },
              },
            ],
          },
        },
      ],
    } satisfies GridDataset;

    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open account",
              href: `/tables/accounts/${node.columns.account_id}`,
            },
          ],
        },
      },
      entry: {
        cell: {
          description: ({ node }) => [
            {
              label: "Open journal",
              href: `/tables/journals/${node.columns.journal_id}`,
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Opening balance");
    expect(
      container.querySelector('[data-grid-copy-menu-scope="true"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(container.innerHTML).toContain('href="/tables/accounts/acct-1"');
    expect(container.innerHTML).toContain('href="/tables/journals/journal-1"');
    expect(container.textContent).toContain("125.00");
    expect(container.textContent).not.toContain("$125.00");
  });

  it("renderCell overrides wrap defaultContent and keep drill-through links", async () => {
    const dataset = accountLedgerDataset();

    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open account",
              href: `/tables/accounts/${node.columns.account_id}`,
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;

    const renderCell = {
      account: {
        name: ({ defaultContent, row }) =>
          createElement(CellTooltip, {
            content: String(row.columns.account_id ?? ""),
            children: defaultContent,
          }),
      },
    } satisfies ReportCellRenderers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links, renderCell }),
    );

    await waitForText(container, "Cash");
    const cell = cellByColumn(container, "name", "Cash");
    const trigger = cell.querySelector(
      '[data-grid-part="cell-tooltip-trigger"]',
    );
    expect(trigger).toBeInstanceOf(HTMLElement);
    expect(trigger?.textContent).toContain("Cash");
    expect(trigger?.closest("a")?.getAttribute("href")).toBe(
      "/tables/accounts/acct-1",
    );
  });

  it("renders declarative dataset column links without app resolvers", async () => {
    const dataset = {
      name: "receivables",
      label: "Receivables",
      rootLevel: "customer",
      levels: {
        customer: {
          columns: [
            {
              id: "customer_id",
              label: "Customer ID",
              kind: "text",
              visuallyHidden: true,
            },
            {
              id: "name",
              label: "Customer",
              kind: "text",
              links: [
                {
                  kind: "table",
                  table: "invoices",
                  bind: { customer_id: "customer_id" },
                  label: "Open invoices",
                },
              ],
            },
            { id: "balance", label: "Balance", kind: "number" },
          ],
          childLevels: [],
          rowLinks: [
            {
              kind: "report",
              report: "customer-statement",
              bind: { customer_id: "customer_id" },
              label: "Customer statement",
            },
          ],
        },
      },
      nodes: [
        {
          rowKey: "cust-1",
          levelName: "customer",
          columns: { customer_id: "cust-1", name: "Acme", balance: 900 },
        },
        {
          rowKey: "subtotal",
          levelName: "customer",
          kind: "subtotal",
          columns: { customer_id: "x", name: "Subtotal", balance: 900 },
        },
      ],
    } satisfies GridDataset;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset }),
    );

    await waitForText(container, "Acme");
    // Declarative table link resolves the bind into an equality filter URL.
    const nameCell = cellByColumn(container, "name", "Acme");
    const anchor = nameCell.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toContain("/tables/invoices?");
    expect(anchor!.getAttribute("href")).toContain("customer_id");
    expect(anchor!.getAttribute("href")).toContain("cust-1");

    // Synthetic rows never resolve declarative links.
    const subtotalCell = cellByColumn(container, "name", "Subtotal");
    expect(subtotalCell.querySelector("a")).toBeNull();
  });

  it("does not render drill-down links for footer rows", async () => {
    const dataset = {
      name: "trial-balance",
      label: "Trial Balance",
      rootLevel: "account",
      levels: {
        account: {
          columns: [
            { id: "account", label: "Account", kind: "text" },
            { id: "debit", label: "Debit", kind: "number" },
          ],
          childLevels: [],
        },
      },
      nodes: [
        {
          rowKey: "cash",
          levelName: "account",
          columns: { account: "Cash", debit: 125 },
        },
      ],
      footerRows: [
        {
          rowKey: "grand-total",
          columns: { account: "Grand Total", debit: 125 },
        },
      ],
    } satisfies GridDataset;

    const account = vi.fn((context: ReportCellLinkContext) => [
      {
        label: "Open account",
        href: `/reports/accounts/${context.node.columns.account}`,
      },
    ]);
    const links = {
      account: {
        cell: {
          account,
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Grand Total");
    expect(container.innerHTML).toContain('href="/reports/accounts/Cash"');
    const footerCell = cellByColumn(container, "account", "Grand Total");
    expect(footerCell.querySelector("a")).toBeNull();
    expect(account).toHaveBeenCalledTimes(1);
  });

  it("renders cell primary links only in the configured column", async () => {
    const dataset = accountLedgerDataset();
    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open ledger",
              href: `/reports/account-ledger?account=${node.columns.account_id}`,
              target: "_blank",
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Cash");
    expect(container.textContent).not.toContain("acct-1");
    expect(
      container.querySelectorAll(
        'a[href="/reports/account-ledger?account=acct-1"]',
      ),
    ).toHaveLength(1);

    const nameCell = cellByColumn(container, "name", "Cash");
    const debitCell = cellByColumn(container, "debit", "125");
    expect(
      nameCell.querySelector(
        'a[href="/reports/account-ledger?account=acct-1"]',
      ),
    ).toBeInstanceOf(HTMLAnchorElement);
    expect(
      debitCell.querySelector(
        'a[href="/reports/account-ledger?account=acct-1"]',
      ),
    ).toBeNull();
  });

  it("uses cell links as primary and leaves secondary destinations out of the grid", async () => {
    const dataset = accountLedgerDataset();
    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open ledger",
              href: `/reports/account-ledger?account=${node.columns.account_id}`,
              target: "_blank",
            },
            {
              label: "Open account detail",
              href: `/reports/account-detail?account=${node.columns.account_id}`,
            },
          ],
          debit: ({ node }) => [
            {
              label: "Open debit bucket",
              href: `/reports/debit-bucket?account=${node.columns.account_id}`,
            },
            {
              label: "Open debit transactions",
              href: `/tables/transactions?account=${node.columns.account_id}&side=debit`,
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Cash");
    const nameCell = cellByColumn(container, "name", "Cash");
    const primary = nameCell.querySelector<HTMLAnchorElement>(
      'a[data-grid-part="report-primary-link"]',
    );
    expect(primary?.getAttribute("href")).toBe(
      "/reports/account-ledger?account=acct-1",
    );
    expect(primary?.getAttribute("tabindex")).toBe("-1");
    expect(primary?.getAttribute("target")).toBe("_blank");
    expect(primary?.getAttribute("rel")).toBe("noopener noreferrer");

    const debitCell = cellByColumn(container, "debit", "125");
    const debitPrimary = debitCell.querySelector<HTMLAnchorElement>(
      'a[data-grid-part="report-primary-link"]',
    );
    expect(debitPrimary?.getAttribute("href")).toBe(
      "/reports/debit-bucket?account=acct-1",
    );
    expect(
      debitCell.querySelector(
        '[data-grid-part="report-link-overflow-trigger"]',
      ),
    ).toBeNull();

    expect(
      document.body.querySelector(
        'a[href="/reports/account-detail?account=acct-1"]',
      ),
    ).toBeNull();
    expect(
      document.body.querySelector(
        'a[href="/tables/transactions?account=acct-1&side=debit"]',
      ),
    ).toBeNull();
  });

  it("opens the primary drill-down link with Enter without expanding the row", async () => {
    const dataset = accountLedgerDataset({ defaultCollapsed: true });
    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open ledger",
              href: `/reports/account-ledger?account=${node.columns.account_id}`,
              target: "_blank",
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset, links }),
      );

      await waitForText(container, "Cash");
      const nameCell = cellByColumn(container, "name", "Cash");
      await mouseDown(nameCell);
      await keyDown(gridRootFor(nameCell), "Enter");

      expect(open).toHaveBeenCalledWith(
        "/reports/account-ledger?account=acct-1",
        "_blank",
        "noopener,noreferrer",
      );
      expect(
        nameCell
          .querySelector('[data-grid-part="expand-cell"]')
          ?.getAttribute("data-expanded"),
      ).toBe("false");
      expect(container.textContent).not.toContain("Opening balance");
    } finally {
      open.mockRestore();
    }
  });

  it("does not invoke link resolvers again when Enter follows the drill-down link", async () => {
    const dataset = accountLedgerDataset({ defaultCollapsed: true });
    const nameLink = vi.fn((context: ReportCellLinkContext) => [
      {
        label: "Open ledger",
        href: `/reports/account-ledger?account=${context.node.columns.account_id}`,
        target: "_blank" as const,
      },
    ]);
    const links = {
      account: {
        cell: {
          name: nameLink,
        },
      },
    } satisfies ReportCellLinkResolvers;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset, links }),
      );

      await waitForText(container, "Cash");
      const nameCell = cellByColumn(container, "name", "Cash");
      await mouseDown(nameCell);
      const callsBeforeEnter = nameLink.mock.calls.length;
      await keyDown(gridRootFor(nameCell), "Enter");

      expect(open).toHaveBeenCalledWith(
        "/reports/account-ledger?account=acct-1",
        "_blank",
        "noopener,noreferrer",
      );
      expect(nameLink).toHaveBeenCalledTimes(callsBeforeEnter);
    } finally {
      open.mockRestore();
    }
  });

  it("toggles nested report rows with Space on the focused expandable cell", async () => {
    const dataset = accountLedgerDataset({ defaultCollapsed: true });
    const container = await renderClient(
      createElement(ReportGridDataset, { dataset }),
    );

    await waitForText(container, "Cash");
    expect(container.textContent).not.toContain("Opening balance");
    const nameCell = cellByColumn(container, "name", "Cash");
    await mouseDown(nameCell);
    await keyDown(gridRootFor(nameCell), " ");

    await waitForText(container, "Opening balance");
    expect(
      nameCell
        .querySelector('[data-grid-part="expand-cell"]')
        ?.getAttribute("data-expanded"),
    ).toBe("true");
  });

  it("toggles nested report rows with Enter when the focused cell resolves no link", async () => {
    const dataset = accountLedgerDataset({ defaultCollapsed: true });
    const container = await renderClient(
      createElement(ReportGridDataset, { dataset }),
    );

    await waitForText(container, "Cash");
    expect(container.textContent).not.toContain("Opening balance");
    const nameCell = cellByColumn(container, "name", "Cash");
    await mouseDown(nameCell);
    await keyDown(gridRootFor(nameCell), "Enter");

    await waitForText(container, "Opening balance");
    expect(
      nameCell
        .querySelector('[data-grid-part="expand-cell"]')
        ?.getAttribute("data-expanded"),
    ).toBe("true");
  });

  it("toggles expansion from the chevron without opening the primary link", async () => {
    const dataset = accountLedgerDataset({ defaultCollapsed: true });
    const links = {
      account: {
        cell: {
          name: ({ node }) => [
            {
              label: "Open ledger",
              href: `/reports/account-ledger?account=${node.columns.account_id}`,
              target: "_blank",
            },
          ],
        },
      },
    } satisfies ReportCellLinkResolvers;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset, links }),
      );

      await waitForText(container, "Cash");
      const nameCell = cellByColumn(container, "name", "Cash");
      const button = nameCell.querySelector('button[aria-label="Expand row"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("expected expand button");
      }
      await click(button);

      await waitForText(container, "Opening balance");
      expect(open).not.toHaveBeenCalled();
      expect(
        nameCell
          .querySelector('[data-grid-part="expand-cell"]')
          ?.getAttribute("data-expanded"),
      ).toBe("true");
    } finally {
      open.mockRestore();
    }
  });

  it("keeps expansion frame state and disabled affordances from the base wrapper", async () => {
    const dataset = accountLedgerDataset({
      defaultCollapsed: true,
      includeSubtotal: true,
    });

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset }),
    );

    await waitForText(container, "Total");
    const nameCell = cellByColumn(container, "name", "Cash");
    const expandCell = nameCell.querySelector('[data-grid-part="expand-cell"]');
    expect(expandCell).toBeInstanceOf(HTMLElement);
    expect(
      nameCell.querySelector('[data-grid-part="expand-content"]'),
    ).toBeInstanceOf(HTMLElement);
    expect(expandCell?.getAttribute("data-expandable")).toBe("true");
    expect(expandCell?.getAttribute("data-expanded")).toBe("false");
    expect(
      nameCell.querySelector('button[aria-label="Expand row"]'),
    ).toBeInstanceOf(HTMLButtonElement);

    const subtotalCell = cellByColumn(container, "name", "Total");
    const disabledButton = subtotalCell.querySelector(
      'button[aria-label="Row"]',
    );
    expect(disabledButton).toBeInstanceOf(HTMLButtonElement);
    expect((disabledButton as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(
      subtotalCell
        .querySelector('[data-grid-part="expand-cell"]')
        ?.getAttribute("data-expanded"),
    ).toBeNull();
  });

  it("keeps its grid runtime live after StrictMode effect replay", async () => {
    const dataset = {
      name: "trial-balance",
      label: "Trial Balance",
      rootLevel: "account",
      levels: {
        account: {
          columns: [
            { id: "account", label: "Account", kind: "text" },
            { id: "debit", label: "Debit", kind: "number" },
          ],
          childLevels: [],
        },
      },
      nodes: [
        {
          rowKey: "cash",
          levelName: "account",
          columns: { account: "Cash", debit: 125 },
        },
      ],
    } satisfies GridDataset;

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset }),
        { strict: true },
      );

      await waitForText(container, "Cash");
      expect(container.textContent).toContain("Cash");
      expect(container.textContent).toContain("125");
      expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
      expect(container.textContent).not.toContain("Loading report...");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps default-expanded nested rows open after StrictMode effect replay", async () => {
    const dataset = {
      name: "account-ledger",
      label: "Account Ledger",
      rootLevel: "account",
      levels: {
        account: {
          columns: [{ id: "name", label: "Account", kind: "text" }],
          childLevels: ["entry"],
        },
        entry: {
          columns: [{ id: "description", label: "Description", kind: "text" }],
          childLevels: [],
        },
      },
      nodes: [
        {
          rowKey: "acct-1",
          levelName: "account",
          columns: { name: "Cash" },
          children: {
            entry: [
              {
                rowKey: "journal-1",
                levelName: "entry",
                columns: { description: "Opening balance" },
              },
            ],
          },
        },
      ],
    } satisfies GridDataset;

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset }),
        { strict: true },
      );

      await waitForText(container, "Opening balance");
      expect(container.textContent).toContain("Cash");
      expect(container.textContent).toContain("Opening balance");
      expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    { strict: false, mode: "ordinary" },
    { strict: true, mode: "StrictMode" },
  ])(
    "replaces the report session on $mode dataset replacement",
    async ({ strict }) => {
      const datasetA = replacementDataset("cash", "Cash");
      const datasetB = replacementDataset("receivables", "Receivables");

      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        const container = await renderClient(
          createElement(ReportGridDataset, { dataset: datasetA }),
          { strict },
        );

        await waitForText(container, "Cash");
        await rerenderClient(
          createElement(ReportGridDataset, { dataset: datasetB }),
          { strict },
        );
        await waitForText(container, "Receivables");

        expect(container.textContent).toContain("Receivables");
        expect(container.textContent).not.toContain("Cash");
        expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it("unmounts a StrictMode report session without reading a disposed runtime", async () => {
    const dataset = replacementDataset("cash", "Cash");

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const container = await renderClient(
        createElement(ReportGridDataset, { dataset }),
        { strict: true },
      );

      await waitForText(container, "Cash");
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted?.container.remove();
      mounted = null;

      expect(hasDisposedRuntimeError(consoleError.mock.calls)).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
