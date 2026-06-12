import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportGridResult, type ReportGridLinkResolvers } from "./ReportGrid";
import type { GridReportResult } from "@sapporta/shared/report-grid";

describe("ReportGridResult", () => {
  it("renders nested rows with app-owned row and cell links", () => {
    const result = {
      name: "account-ledger",
      label: "Account Ledger",
      columns: [
        { name: "account_id", label: "Account ID", visuallyHidden: true },
        { name: "name", label: "Account" },
      ],
      levelColumns: {
        account: [
          { name: "account_id", label: "Account ID", visuallyHidden: true },
          { name: "name", label: "Account" },
        ],
        entry: [
          { name: "journal_id", label: "Journal ID", visuallyHidden: true },
          { name: "description", label: "Description" },
          {
            name: "amount",
            label: "Amount",
            kind: "number",
            displayFormat: "currency",
          },
        ],
      },
      data: [
        {
          levelName: "account",
          columns: { account_id: "acct-1", name: "Cash" },
          children: {
            entry: [
              {
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
    } satisfies GridReportResult;

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
      createElement(ReportGridResult, { result, links }),
    );

    expect(html).toContain('href="/tables/accounts/acct-1"');
    expect(html).toContain('href="/tables/journals/journal-1"');
    expect(html).toContain("Opening balance");
    expect(html).toContain("125.00");
    expect(html).not.toContain("$125.00");
  });

  it("renders footer links from app-owned resolvers", () => {
    const result = {
      name: "trial-balance",
      label: "Trial Balance",
      columns: [
        { name: "account", label: "Account" },
        { name: "debit", label: "Debit", kind: "number" },
      ],
      levelColumns: {
        account: [
          { name: "account", label: "Account" },
          { name: "debit", label: "Debit", kind: "number" },
        ],
      },
      data: [
        {
          levelName: "account",
          columns: { account: "Cash", debit: 125 },
        },
      ],
      footerRows: [
        {
          label: "Grand Total",
          columns: { debit: 125 },
        },
      ],
    } satisfies GridReportResult;

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
      createElement(ReportGridResult, { result, links }),
    );

    expect(html).toContain('href="/reports/trial-balance/detail"');
    expect(html).toContain("Grand Total");
  });
});
