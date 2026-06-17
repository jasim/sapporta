import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportGridDataset, type ReportGridLinkResolvers } from "./ReportGrid";
import type { GridDataset } from "@sapporta/shared/grid-dataset";

describe("ReportGridDataset", () => {
  it("renders nested rows with app-owned row and cell links", () => {
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

    const html = renderToStaticMarkup(
      createElement(ReportGridDataset, { dataset, links }),
    );

    expect(html).toContain('href="/tables/accounts/acct-1"');
    expect(html).toContain('href="/tables/journals/journal-1"');
    expect(html).toContain("Opening balance");
    expect(html).toContain("125.00");
    expect(html).not.toContain("$125.00");
  });

  it("renders footer links from app-owned resolvers", () => {
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

    const html = renderToStaticMarkup(
      createElement(ReportGridDataset, { dataset, links }),
    );

    expect(html).toContain('href="/reports/trial-balance/detail"');
    expect(html).toContain("Grand Total");
  });
});
