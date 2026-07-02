# Route-Based Reports

A report is an app-owned API route that returns grid-renderable data. Sapporta
provides the route tools, shared result shape, and renderer; the app owns the
path, authorization, query logic, screen, and navigation.

The usual shape is:

1. Define a shared route contract in `packages/shared/src/contracts`.
2. Implement the backend handler under `packages/api/app`.
3. Build a React screen under `packages/frontend/src`.
4. Render the returned `GridDataset` with `ReportGridDataset`.

Simple reports usually use `GET` query parameters. More complex inputs can use
a `POST` body.

## Flat Report

```ts
import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import {
  gridDatasetSchema,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
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
    200: gridDatasetSchema,
    400: errorBodySchema,
    403: errorBodySchema,
  },
});
```

The backend returns a plain object that satisfies the shared result type.

```ts
import { sql } from "drizzle-orm";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
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
): GridDataset {
  return {
    name: "trial-balance",
    label: "Trial Balance",
    rootLevel: "account",
    levels: {
      account: {
        columns: [
          { id: "account", label: "Account", kind: "text" },
          {
            id: "debit",
            label: "Debit",
            kind: "number",
            displayFormat: "currency",
            zeroDisplay: "blank",
          },
          {
            id: "credit",
            label: "Credit",
            kind: "number",
            displayFormat: "currency",
            zeroDisplay: "blank",
          },
        ],
        childLevels: [],
      },
    },
    nodes: rows.map((row) => ({
      rowKey: row.account,
      levelName: "account",
      columns: row,
    })),
    footerRows: [
      {
        rowKey: "grand-total",
        columns: {
          account: "Grand Total",
          debit: rows.reduce((sum, row) => sum + row.debit, 0),
          credit: rows.reduce((sum, row) => sum + row.credit, 0),
        },
      },
    ],
  };
}
```

Render the route result in an app screen.

For normal reports, use Sapporta's report component. If you are building a
different grid-like screen with its own row shape, loading behavior, hierarchy,
editing rules, or side panels, start with the
[BaseGrid guide](../BASEGRID-GUIDE.md#build-a-custom-grid-screen) instead of
copying report internals.

```tsx
import { useEffect, useState } from "react";
import { ReportGridDataset, ReportScreenFrame } from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsApi } from "../api";

export function TrialBalanceReport() {
  const [dataset, setDataset] = useState<GridDataset | null>(null);

  useEffect(() => {
    void reportsApi
      .trialBalance({ query: { asOfDate: "2026-06-12" } })
      .then(setDataset);
  }, []);

  return (
    <ReportScreenFrame title="Trial Balance">
      {dataset ? <ReportGridDataset dataset={dataset} /> : null}
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
  const body = gridDatasetSchema.parse(await response.json());
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
): GridDataset {
  const nodes = sections.map((section) => {
    const childRows = accounts.filter((row) => row.section === section.section);
    const childNodes = childRows.map((row) => ({
      rowKey: row.account,
      levelName: "account",
      columns: { account: row.account, balance: row.balance },
    }));
    const sectionTotal = childRows.reduce((sum, row) => sum + row.balance, 0);

    return {
      rowKey: section.section,
      levelName: "section",
      columns: { section: section.section },
      rollup: { section_total: sectionTotal },
      children: { account: childNodes },
    };
  });

  const assets = nodes.find((node) => node.columns.section === "Asset");
  const liabilities = nodes.find((node) => node.columns.section === "Liability");
  const equity = nodes.find((node) => node.columns.section === "Equity");

  return {
    name: "balance-sheet",
    label: "Balance Sheet",
    rootLevel: "section",
    levels: {
      section: {
        columns: [
          { id: "section", label: "Section", kind: "text" },
          {
            id: "section_total",
            label: "Total",
            kind: "number",
            displayFormat: "currency",
          },
        ],
        childLevels: ["account"],
      },
      account: {
        columns: [
          { id: "account", label: "Account", kind: "text" },
          {
            id: "balance",
            label: "Balance",
            kind: "number",
            displayFormat: "currency",
          },
        ],
        childLevels: [],
      },
    },
    nodes,
    footerRows: [
      {
        rowKey: "total-liabilities-equity",
        columns: {
          section: "Total Liabilities + Equity",
          section_total:
            Number(liabilities?.rollup?.section_total ?? 0) +
            Number(equity?.rollup?.section_total ?? 0),
        },
      },
      {
        rowKey: "net",
        columns: {
          section: "Net",
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

`GridDataset` does not serialize links. Frontend screens pass link
resolvers to `ReportGridDataset` because the screen owns route state, current
parameters, and navigation policy.

```tsx
<ReportGridDataset
  dataset={dataset}
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
<ReportGridDataset
  dataset={dataset}
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

`ReportGridDataset` is a renderer. It does not run queries, discover reports,
authorize access, or decide which reports appear in navigation.
