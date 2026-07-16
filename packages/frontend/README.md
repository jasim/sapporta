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
