---
"@sapporta/frontend": minor
---

The table page, filters, forms, report chrome, auth and account screens, the
boot loader and the shell components take their sizes from the token tiers
instead of fixed pixels, so an app that redeclares the tiers reaches them.
Pagers, search fields, filter cards, condition editors, date inputs and the
Retry button are `h-sap-ctl` controls with `rounded-md`; popovers, menus,
bottom sheets and the record detail sheet use `rounded-lg`/`rounded-xl` and
`shadow-sap-elevated`; headings sit on `sap-display`, body text on
`sap-body`, helper text on `sap-meta`. `text-red-600` became
`text-sap-negative`, `bg-sap-brand text-white` became
`bg-primary text-primary-foreground`, and sign-in links are styled.

`TGrid` and `ReportGridDataset` accept `columnSizing`, including the grid's
new `minWidths`, so an app can widen numeric and timestamp columns. The table
card's label, title and radius, and the report grid's nested indent
(`--sap-report-grid-nested-indent`), read tokens.
