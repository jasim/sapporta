---
"@sapporta/server": minor
"@sapporta/shared": minor
"@sapporta/frontend": minor
---

Enable table search by default and replace `search.columns` with explicit,
recursive search configuration.

Tables now search all visible application columns when `meta.search` is
omitted. Set `search: false` to disable the endpoint behavior and hide the
search control, use `"allColumns"` for one table node, or select fields with
`self`. Foreign keys match the referenced row label instead of the stored ID.

Has-many traversal is opt-in:

```ts
meta: {
  rowLabelColumns: ["title"],
  children: [{ table: "quotes", foreignKey: "book_id" }],
  search: {
    self: ["id", "title", "author_id"],
    children: {
      quotes: {
        self: ["quote_text"],
      },
    },
  },
}
```

Expanded quote grids use their own query. A search that determines which books
appear no longer filters the quotes loaded after a book is expanded.
