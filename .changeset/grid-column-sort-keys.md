---
"@sapporta/grid": minor
---

A column can list `sortKeys`: the row fields a sort on it orders by, each with
its own `compare`. All keys follow the sort's direction, and the sort still
names the column, so its header shows the arrow. A field may be one no column
shows. Without `sortKeys`, a column orders by its own value with `compare`.
