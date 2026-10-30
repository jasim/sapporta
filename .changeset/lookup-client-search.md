---
"@sapporta/frontend": minor
"@sapporta/shared": minor
"@sapporta/grid": patch
---

`useTableLookup` and a lookup store's `table()` take `{ search: "client" }`,
for a tree table whose whole narrowed tree a picker already holds. Typing
then matches that tree in the browser: every match, in tree order, without a
request per keystroke. Until the tree is read, or when it could not be read,
such as one too large to send, the search runs on the server. `"server"`
stays the default, as a grid's foreign-key cell needs.
`createTableLookupSource` takes the search as its fourth argument, which is
now required, as are `computed` and `narrowing` before it (pass `undefined`
for none).

`lookupEntryMatches` in `@sapporta/shared` is the rule a lookup search
follows: the text, ignoring case, inside the label or a displayed field. The
server's lookup search, the client search and `StaticSearchLookup` all find
the same rows by it.
