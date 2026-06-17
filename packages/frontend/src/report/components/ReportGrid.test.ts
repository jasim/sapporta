// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportGridDataset, type ReportGridLinkResolvers } from "./ReportGrid";
import type { GridDataset } from "@sapporta/shared/grid-dataset";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReportGridDataset", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (!mounted) return;
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
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

  it("renders nested rows with app-owned row and cell links", async () => {
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
        row: ({ node }) => [
          {
            label: "Open account",
            href: `/tables/accounts/${node.columns.account_id}`,
            kind: "record",
          },
        ],
      },
      entry: {
        cell: {
          description: ({ node }) => [
            {
              label: "Open journal",
              href: `/tables/journals/${node.columns.journal_id}`,
              kind: "record",
            },
          ],
        },
      },
    } satisfies ReportGridLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Opening balance");
    expect(container.innerHTML).toContain('href="/tables/accounts/acct-1"');
    expect(container.innerHTML).toContain('href="/tables/journals/journal-1"');
    expect(container.textContent).toContain("125.00");
    expect(container.textContent).not.toContain("$125.00");
  });

  it("renders footer links from app-owned resolvers", async () => {
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

    const links = {
      account: {
        footer: () => [
          {
            label: "Open detail",
            href: "/reports/trial-balance/detail",
            kind: "route",
          },
        ],
      },
    } satisfies ReportGridLinkResolvers;

    const container = await renderClient(
      createElement(ReportGridDataset, { dataset, links }),
    );

    await waitForText(container, "Grand Total");
    expect(container.innerHTML).toContain(
      'href="/reports/trial-balance/detail"',
    );
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
      expect(
        consoleError.mock.calls.some((call) =>
          call.some((arg) =>
            String(arg).includes("GridRuntime has been disposed"),
          ),
        ),
      ).toBe(false);
      expect(container.textContent).not.toContain("Loading report...");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("replaces the StrictMode replayed session instead of reusing a disposed runtime", async () => {
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
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted?.container.remove();
      mounted = null;

      expect(
        consoleError.mock.calls.some((call) =>
          call.some((arg) =>
            String(arg).includes("GridRuntime has been disposed"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
