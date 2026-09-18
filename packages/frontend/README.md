# @sapporta/frontend

Default Sapporta admin frontend: app boot wiring, shell, schema catalog stores,
table routes, report routes, and product-level pages.

This package composes `@sapporta/ui`, `@sapporta/grid`, and
`@sapporta/shared`. Import `@sapporta/ui/index.css`,
`@sapporta/grid/index.css`, and `@sapporta/frontend/index.css` from the
application entry for tokens, base styles, grid CSS, and admin frontend
Tailwind source hints.

## Table actions

The standard table header accepts an application-defined `actions` component.
Sapporta renders the component in the wide toolbar and the narrow table-actions
sheet. The component receives the live table session and controlled level.

```tsx
import {
  TableRoute,
  type SchemaTableRowsByLevel,
  type TableGridActionsProps,
} from "@sapporta/frontend";
import { Button } from "@sapporta/ui/button";

function OrderActions(props: TableGridActionsProps<SchemaTableRowsByLevel>) {
  const visibleRowCount = props.session.getVisibleRows(props.level).length;

  async function reload(): Promise<void> {
    await props.session.reloadRows(props.level);
    if (props.surface === "action-sheet") props.close();
  }

  return (
    <Button
      type="button"
      variant={props.surface === "toolbar" ? "outline" : "default"}
      className={
        props.surface === "action-sheet" ? "w-full justify-start" : undefined
      }
      onClick={() => void reload()}
    >
      Reload {visibleRowCount} visible rows
    </Button>
  );
}

export function AppTableRoute() {
  return (
    <TableRoute
      gridOptionsByTable={{
        orders: { actions: OrderActions },
      }}
    />
  );
}
```

The same component can be passed directly as `actions` on
`SchemaTableGridView`. Public table hooks can read query, selection, and source
status from the supplied session when an action needs reactive table state.

## TGrid active rows

`useTGridActiveRow(session)` exposes the current typed application row as React
state. The hook updates when row identity or displayed values change. `TGrid`
forwards successful configured row activations through `onRowActivate`.
Repeated activation of the same active row produces repeated callbacks.

```tsx
import {
  TGrid,
  useTGridActiveRow,
  type TGridSession,
} from "@sapporta/frontend";

type OrdersRows = {
  orders: { id: string; customer: string };
};

function OrdersGrid({ session }: { session: TGridSession<OrdersRows> }) {
  const activeRow = useTGridActiveRow(session);

  return (
    <section>
      <TGrid
        session={session}
        onRowActivate={(event) => {
          if (event.activeRow.kind === "data") {
            openOrder(event.activeRow.values.id);
          }
        }}
      />
      <output>
        {activeRow?.kind === "data" ? activeRow.values.customer : ""}
      </output>
    </section>
  );
}
```

`TGridSession.activeRow()` and `TGridSession.subscribeActiveRow()` provide the
same typed state outside React. `TGridSession.onRowActivate()` provides the
framework-neutral row-activation event adapter.

## Report trees

`ReportGridDataset` from `@sapporta/frontend/report` shows a `GridDataset`
level that declares `tree` as one tree under one header. For example, an
expense report can show accounts that name their parent account in
`parent_id`:

```tsx
import { ReportGridDataset } from "@sapporta/frontend/report";
import type { GridDataset } from "@sapporta/shared/grid-dataset";

const expenses: GridDataset = {
  name: "expense-breakdown",
  label: "Expense breakdown",
  rootLevel: "account",
  levels: {
    account: {
      columns: [
        {
          id: "parent_id",
          label: "Parent",
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
    },
  },
  nodes: [
    {
      rowKey: "1",
      levelName: "account",
      columns: { parent_id: null, name: "Office", amount: 400 },
    },
    {
      rowKey: "2",
      levelName: "account",
      columns: { parent_id: 1, name: "Rent", amount: 300 },
    },
    {
      rowKey: "3",
      levelName: "account",
      columns: { parent_id: 1, name: "Supplies", amount: 100 },
    },
  ],
  footerRows: [
    { rowKey: "total", columns: { name: "Total expenses", amount: 400 } },
  ],
};

export function ExpenseBreakdown() {
  return <ReportGridDataset dataset={expenses} />;
}
```

Each row is indented by its depth in the tree column, which is the first
visible text column unless `tree.column` names another one. A row with
children has a chevron. Enter opens the cell's link, and Space or the chevron
expands or collapses the row. Rows start expanded; `defaultCollapsed: true` on
the level starts them collapsed. The renderer does not add up amounts, so the
dataset carries each parent row's total.

`ReportCellLinkContext.ancestors` holds the rows of enclosing levels only. A
link resolver on a tree row reads its parent's key from the row's own
`parent_id` value.
