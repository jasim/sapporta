# Grid Dataset Shape

The canonical report wire type lives at `@sapporta/shared/grid-dataset`.

```ts
import type {
  GridDataset,
  GridDatasetColumn,
  GridDatasetFooterRow,
  GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
```

`GridDataset` contains:

- `name` and `label` for the dataset.
- `rootLevel`, the level rendered at the root.
- `levels`, keyed by each node level name.
- `nodes`, an array of `GridDatasetNode`.
- optional `footerRows`, `totalCount`, `stats`, and `errors`.

`GridDataset` is a renderer wire shape. It does not describe how to query
data, authorize the route, or place reports in navigation.

This shape is for report data. If you are building a different custom
grid-like screen, start with the
[BaseGrid guide](../BASEGRID-GUIDE.md#build-a-custom-grid-screen) instead.

Columns should include hidden identifiers when the frontend needs them for
navigation:

```ts
const dataset = {
  name: "trial-balance",
  label: "Trial Balance",
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
  nodes: [
    {
      rowKey: "account-1",
      levelName: "account",
      columns: {
        account_id: "account-1",
        name: "Cash",
        balance: 1250,
      },
    },
  ],
} satisfies GridDataset;
```

The response does not serialize links. Frontend screens pass link resolvers to
`ReportGridDataset` because they own route state, current parameters, and
navigation policy.

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
      cell: {
        name: ({ node, column }) => [
          {
            label: "Open ledger",
            href: `/reports/account-ledger?account_id=${node.columns.account_id}&column=${column.id}`,
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
