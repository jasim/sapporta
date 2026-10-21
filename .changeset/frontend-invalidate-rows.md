---
"@sapporta/frontend": minor
---

`invalidateRows(table?)` refreshes rows everywhere they are shown. A write in
one table grid now also refreshes the captions and labels in other grids,
pickers and forms on screen, not only its own. Call `invalidateRows` after
your own endpoints write, so Sapporta's screens show the new values. A store
made with `createLookupStore` joins with `connectRowDataStore(store)`;
grids and `useLookupStore` join on their own. `store.reloadLabels()` with no
table reloads every table's labels.
