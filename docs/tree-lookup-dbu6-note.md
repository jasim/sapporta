# What dbu6 can delete once it adopts tree lookups

Sapporta's `LookupPicker` now draws a tree table (`meta.tree`) as a tree. The
server walks the tree, leaves out the edited row's branch, gives the parent
paths, and runs the search. The dbu6 picker in
`src/frontend/components/account-pickers.tsx` rebuilds all four in the browser.

## Schema change

In `src/server/schema/accounts.ts`, extend the tree declaration:

```ts
tree: {
  parentColumn: "parent_id",
  path: "parentPath",
  rootOrder: {
    column: "account_type",
    values: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
  },
},
```

`defaultSort: asc(accountsTable.name)` stays and orders the siblings. The
Accounts page then shows the top-level accounts in type order too.

## What can be deleted

- **The tree walk:** `treeItems()` and the `TreeItem` type. These group rows by
  `parent_id`, sort the roots by `LEDGER_ACCOUNT_TYPES`, keep eligible rows and
  their ancestors, and drop empty branches. The `_lookup_tree` route does this,
  and `rootOrder` replaces the type sort.
- **Branch exclusion:** the `self` handling inside `treeItems()`. Pass
  `notUnder: accountId` to `useTableLookup` instead.
- **Path joining:** the `prefix` built from `selectedPath +
ACCOUNT_PATH_SEPARATOR.trimEnd()`, and the path drawn before each search
  match. The picker draws `parentPath` with the separator given to
  `treePath()`.
- **The client-side search:** the `needle` filter over `item.account.name`.
  Pass `{ search: "client" }` to `useTableLookup` instead: the lookup then
  searches the tree it read, in tree order, by the same rule as the server.
- **The row parser and the chart read, for the pickers:** `AccountTreeCombobox`
  and `AccountCombobox` read every account through `accountChartQuery` and
  parse each one with `accountRow()`. The tree lookup returns the whole
  narrowed tree in one request, so the pickers need neither.
  `accountChartQuery` and `useAccountParentPaths` stay only while other
  screens still use them: `ImportFreeformTransactions` and `BanksAndCards`.
- **The `Field` and `Popup` wrappers**, once `InstitutionCombobox` is the only
  user left. That picker is not a table lookup, so it stays.

## What dbu6 keeps

Only the narrowing, as `useTableLookup` arguments:

- "accounts of this type":
  `{ filter: [{ column: "account_type", op: "in", values: [...] }] }`.
- `AccountCombobox`'s explicit `choices` list:
  `{ filter: [{ column: "id", op: "in", values: ids }] }`. The filter travels
  in the request's query string, so a list of more than about 2,000 ids is
  refused by the server (431) and the picker shows `labels.loadFailed`. An
  empty list cannot be sent: the filter grammar refuses `in []`, and the
  picker would show `labels.loadFailed` for it. Decide what an empty `choices`
  draws before building the filter.
- "(this account)" for the edited row, if the generic "(being edited)" is not
  wanted: pass `labels={{ editing: "(this account)" }}`. The accounts label
  slot receives the same words as `context.editingNote`.

`AccountTreeCombobox` then becomes a `LookupPicker<number>` over
`useTableLookup<number>("accounts", narrowing, { search: "client" })`,
called with the same `id`, `value`, `onChange`, `placeholder`, `disabled`
and `className` props.
`clearLabel` maps to `allowClear` and `labels.clear`.

Typing still finds every match in tree order. Until the tree is read, or
when it is too large to send, typing searches the server instead: at most 50
matches, in the server's order.
