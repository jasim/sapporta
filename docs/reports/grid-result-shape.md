# Grid Result Shape

The canonical report wire type lives at `@sapporta/shared/report-grid`.

```ts
import type {
  GridColumn,
  GridFooterRow,
  GridReportNode,
  GridReportResult,
} from "@sapporta/shared/report-grid";
```

`GridReportResult` contains:

- `name` and `label` for the dataset.
- `columns` for the top-level grid.
- `levelColumns` keyed by each node level name.
- `data`, an array of `GridReportNode`.
- optional `footerRows`, `levelOptions`, `stats`, and `errors`.

`GridReportResult` is a renderer wire shape. It does not describe how to query
data, authorize the route, or place reports in navigation.

This shape is for report data. If you are building a different custom
grid-like screen, start with the
[BaseGrid guide](../BASEGRID-GUIDE.md#build-a-custom-grid-screen) instead.

Columns should include hidden identifiers when the frontend needs them for
navigation:

```ts
const levelColumns = {
  account: [
    { name: "account_id", label: "Account ID", visuallyHidden: true },
    { name: "name", label: "Account" },
    {
      name: "balance",
      label: "Balance",
      kind: "number",
      displayFormat: "currency",
    },
  ],
} satisfies Record<string, GridColumn[]>;
```

The response does not serialize links. Frontend screens pass link resolvers to
`ReportGridResult` because they own route state, current parameters, and
navigation policy.

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
      cell: {
        name: ({ node }) => [
          {
            label: "Open ledger",
            href: `/reports/account-ledger?account_id=${node.columns.account_id}`,
            kind: "route",
          },
        ],
      },
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

Footer link resolvers apply to the whole footer row. They are not per-cell
footer resolvers.
