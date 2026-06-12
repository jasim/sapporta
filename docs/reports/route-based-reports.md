# Route-Based Reports

A report is an app-owned API route that returns grid-renderable data. Sapporta
provides the route tools, shared result shape, and renderer; the app owns the
path, authorization, query logic, screen, and navigation.

The usual shape is:

1. Define a shared route contract in `packages/shared/src/contracts`.
2. Implement the backend handler under `packages/api/app`.
3. Build a React screen under `packages/frontend/src`.
4. Render the returned `GridReportResult` with `ReportGridResult`.

Simple reports usually use `GET` query parameters. More complex inputs can use
a `POST` body.

## Flat Report

```ts
import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import {
  gridReportResultSchema,
  type GridReportResult,
} from "@sapporta/shared/report-grid";
import { errorBodySchema } from "@sapporta/shared/contracts";

const c = initContract();

export const trialBalanceRoute = c.query({
  method: "GET",
  path: "/reports/trial-balance",
  summary: "Trial Balance",
  metadata: { tags: ["reports"] },
  query: z.object({
    asOfDate: z.string(),
  }),
  responses: {
    200: gridReportResultSchema,
    400: errorBodySchema,
    403: errorBodySchema,
  },
});
```

The backend returns a plain object that satisfies the shared result type.

```ts
import { sql } from "drizzle-orm";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { accounts, journals, journalEntries } from "../schema/index";
import { trialBalanceRoute } from "my-app-shared/contracts/reports";

const api = new TsRestApi<SapportaEnv>();

api.register("trialBalance", trialBalanceRoute, async ({ c, request }) => {
  const db = c.get("db");
  const auth = c.get("auth");
  auth.requireCan("read", "reports:trial-balance");

  const rows = await db
    .select({
      account: accounts.drizzle.name,
      debit: sql<number>`max(coalesce(sum(${journalEntries.drizzle.debit}), 0) - coalesce(sum(${journalEntries.drizzle.credit}), 0), 0)`,
      credit: sql<number>`max(coalesce(sum(${journalEntries.drizzle.credit}), 0) - coalesce(sum(${journalEntries.drizzle.debit}), 0), 0)`,
    })
    .from(accounts.drizzle)
    .leftJoin(
      journalEntries.drizzle,
      sql`${journalEntries.drizzle.accountId} = ${accounts.drizzle.id}`,
    )
    .leftJoin(
      journals.drizzle,
      sql`${journals.drizzle.id} = ${journalEntries.drizzle.journalId}`,
    )
    .where(sql`${journals.drizzle.date} <= ${request.query.asOfDate}`)
    .groupBy(accounts.drizzle.name)
    .all();

  return { status: 200, body: toTrialBalanceResult(rows) };
});

function toTrialBalanceResult(
  rows: { account: string; debit: number; credit: number }[],
): GridReportResult {
  const levelColumns = {
    account: [
      { name: "account", label: "Account" },
      {
        name: "debit",
        label: "Debit",
        kind: "number",
        displayFormat: "currency",
        zeroDisplay: "blank",
      },
      {
        name: "credit",
        label: "Credit",
        kind: "number",
        displayFormat: "currency",
        zeroDisplay: "blank",
      },
    ],
  };

  return {
    name: "trial-balance",
    label: "Trial Balance",
    columns: levelColumns.account,
    levelColumns,
    data: rows.map((row) => ({
      levelName: "account",
      columns: row,
    })),
    footerRows: [
      {
        label: "Grand Total",
        columns: {
          debit: rows.reduce((sum, row) => sum + row.debit, 0),
          credit: rows.reduce((sum, row) => sum + row.credit, 0),
        },
      },
    ],
  };
}
```

Render the route result in an app screen.

```tsx
import { useEffect, useState } from "react";
import { ReportGridResult, ReportScreenFrame } from "@sapporta/frontend/report";
import type { GridReportResult } from "@sapporta/shared/report-grid";
import { reportsApi } from "../api";

export function TrialBalanceReport() {
  const [result, setResult] = useState<GridReportResult | null>(null);

  useEffect(() => {
    void reportsApi
      .trialBalance({ query: { asOfDate: "2026-06-12" } })
      .then(setResult);
  }, []);

  return (
    <ReportScreenFrame title="Trial Balance">
      {result ? <ReportGridResult result={result} /> : null}
    </ReportScreenFrame>
  );
}
```

Test the route like any other app API.

```ts
it("returns a trial balance grid", async () => {
  const response = await app.request(
    "/api/reports/trial-balance?asOfDate=2026-06-12",
  );
  expect(response.status).toBe(200);
  const body = gridReportResultSchema.parse(await response.json());
  expect(body.name).toBe("trial-balance");
});
```

## Date Range Query Helper

Date-range fields use the shared flat URL shape:

- `period_relative=30d`
- `period_from=2026-01-01&period_to=2026-01-31`

Route handlers can resolve those fields once at the API boundary.

```ts
import { resolveDateRangeQueryBounds } from "@sapporta/shared";

api.register(
  "incomeStatement",
  incomeStatementRoute,
  async ({ c, request }) => {
    const period = resolveDateRangeQueryBounds("period", request.query);

    const rows = await readIncomeRows({
      db: c.get("db"),
      fromDate: period.from,
      toDate: period.to,
    });

    return { status: 200, body: toIncomeStatementResult(rows) };
  },
);
```

`from` and `to` are ISO date strings or `null`. A `null` side means unbounded,
so SQL can use `($fromDate IS NULL OR date >= $fromDate)` and
`($toDate IS NULL OR date <= $toDate)` style predicates.

## Hierarchical Report

Hierarchical reports return parent nodes with child groups. Keep the mapper
pure so it can be tested without a database.

```ts
type SectionRow = {
  section: "Asset" | "Liability" | "Equity";
  sortOrder: number;
};

type AccountBalanceRow = {
  section: SectionRow["section"];
  account: string;
  balance: number;
};

export function toBalanceSheetResult(
  sections: SectionRow[],
  accounts: AccountBalanceRow[],
): GridReportResult {
  const levelColumns = {
    section: [
      { name: "section", label: "Section" },
      {
        name: "section_total",
        label: "Total",
        kind: "number",
        displayFormat: "currency",
      },
    ],
    account: [
      { name: "account", label: "Account" },
      {
        name: "balance",
        label: "Balance",
        kind: "number",
        displayFormat: "currency",
      },
    ],
  };

  const data = sections.map((section) => {
    const childRows = accounts.filter((row) => row.section === section.section);
    const childNodes = childRows.map((row) => ({
      levelName: "account",
      columns: { account: row.account, balance: row.balance },
    }));
    const sectionTotal = childRows.reduce((sum, row) => sum + row.balance, 0);

    return {
      levelName: "section",
      columns: { section: section.section },
      rollup: { section_total: sectionTotal },
      children: { account: childNodes },
    };
  });

  const assets = data.find((node) => node.columns.section === "Asset");
  const liabilities = data.find((node) => node.columns.section === "Liability");
  const equity = data.find((node) => node.columns.section === "Equity");

  return {
    name: "balance-sheet",
    label: "Balance Sheet",
    columns: levelColumns.section,
    levelColumns,
    data,
    footerRows: [
      {
        label: "Total Liabilities + Equity",
        columns: {
          section_total:
            Number(liabilities?.rollup?.section_total ?? 0) +
            Number(equity?.rollup?.section_total ?? 0),
        },
      },
      {
        label: "Net",
        columns: {
          section_total:
            Number(assets?.rollup?.section_total ?? 0) -
            (Number(liabilities?.rollup?.section_total ?? 0) +
              Number(equity?.rollup?.section_total ?? 0)),
        },
      },
    ],
  };
}
```

## Links

`GridReportResult` does not serialize links. Frontend screens pass link
resolvers to `ReportGridResult` because the screen owns route state, current
parameters, and navigation policy.

```tsx
<ReportGridResult
  result={result}
  links={{
    account: {
      row: ({ node }) => [
        {
          label: "Open account",
          href: `/tables/accounts/${node.columns.account_id}`,
          kind: "record",
        },
      ],
    },
  }}
/>
```

Footer link resolvers apply to the whole footer row. They are not per-cell link
resolvers.

```tsx
<ReportGridResult
  result={result}
  links={{
    account: {
      footer: () => [
        {
          label: "Open total detail",
          href: "/reports/trial-balance/detail",
          kind: "route",
        },
      ],
    },
  }}
/>
```

## Navigation

Report navigation is app-owned. Add report links to your app navigation, and
mount the React screen with normal React Router routes.

```tsx
import { Route } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import type { Navigation } from "@sapporta/frontend/shell";
import { TrialBalanceReport } from "./reports/TrialBalanceReport";

export const appNavigation: Navigation = [
  {
    label: "Reports",
    items: [
      { label: "Trial Balance", to: "/reports/trial-balance", icon: BarChart3 },
    ],
  },
];

export const appProtectedRoutes = (
  <>
    <Route path="reports/trial-balance" element={<TrialBalanceReport />} />
  </>
);
```

`ReportGridResult` is a renderer. It does not run queries, discover reports,
authorize access, or decide which reports appear in navigation.
