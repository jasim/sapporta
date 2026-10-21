---
"@sapporta/server": minor
"@sapporta/shared": minor
---

Tables can declare computed fields: named values of each row that the server
computes when a read asks for them, such as an account's parent path or an
item's stock on hand. Declare them with `computed: { name: computedField({
kind, load }) }` in `sapportaTable`. A loader receives a batch of rows
(`table`, `ids`, `once()`, `db`, `auth`) and returns a value for every id, with
`null` for a row that has no value. Fields that share a query, or that build on
each other's values, share the work through `once()`. `treePath()` gives each
row of a tree table its ancestors' labels, such as "Expenses > Kitchen".

Every row read of the table API takes `computed=name,name2`: the list
(including tree reads and child levels), the single-row read and the lookup.
Create and update compute nothing, so a saved row is never reported as an
error. The response then carries `computed`, which maps each field
name to the row ids and their values. A field that fails, or that leaves out an
id, fails the request, and an unknown name is a 400. `computeFields()` runs
the same loaders from your own endpoints and reports.

`meta.rowCaption` names a column or computed field that the default display of
a row draws under its label. The table schema lists the computed fields
(`computed`) and the caption (`rowCaption`).
