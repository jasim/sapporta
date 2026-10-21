---
"@sapporta/frontend": minor
---

`ReportGridDataset` draws `reference` columns with the referenced table's
`label` slot. It uses the values the report sent in `computed`, and asks for
anything else in one lookup per table. A `renderCell` override for the column
receives the reference drawing as `defaultContent`, and column links keep
working.
