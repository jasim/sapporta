---
"@sapporta/shared": minor
"@sapporta/server": minor
"@sapporta/frontend": minor
---

Lookups can offer only some rows of a table.

- The lookup search takes `filter[col][op]=value`, the same filters as list
  reads, so a picker can offer, say, accounts of one type. Lookups by id take
  no filter, so a chosen row keeps its label after it stops matching.
- `notUnder=<id>` leaves out a row of a tree table and every row below it:
  the choices for a row's parent, without the ones that would make a loop.
- `useTableLookup("accounts", { filter: [{ column: "account_type", op: "in",
  values: ["asset"] }], notUnder: accountId })` gives a `LookupPicker` that
  searches only those rows. `store.table(name, narrowing)` does the same for
  a row store.
