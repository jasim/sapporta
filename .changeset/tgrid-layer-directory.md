---
"@sapporta/frontend": patch
---

Make the TGrid layer visible as a directory and unify the report grid
vocabulary. `src/table/grid-adapter/`, the `tgrid-*` state files, and the
`TGrid` view now live together in `src/table/tgrid/`; the rest of
`src/table/` is the table-screen layer built on top. On the report side,
`ReportGrid.tsx` is now `ReportGridDataset.tsx` to match its public
`ReportGridDataset` export, and the one-file `src/grid-dataset/` directory
(which collided with `@sapporta/shared/grid-dataset`) moved into
`src/report/grid-dataset-path.ts`. Exports are unchanged. The only
observable difference: the report grid's internal CSS block was renamed
from `sapporta-report-tgrid*` to `sapporta-report-grid-dataset*`
(`data-grid-part` hooks are untouched), so any app styling against the
old class names must update them.
