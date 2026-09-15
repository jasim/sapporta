---
"@sapporta/frontend": minor
---

Importing `@sapporta/frontend/shell` no longer switches the document to the
dark palette. Until now the theme store set `data-theme` on `<html>` as soon as
its module loaded, so an app that imported `SidebarProvider` for its own shell
got the dark palette whenever the visitor's system preferred it, with no way
to opt out.

`useDocumentTheme()` now does that work while a component is mounted.
`AppShell` calls it, so apps on the standard shell see no change. An app with
its own shell calls it to support the dark palette, or leaves it out to stay
light. `useThemeStore.getState().forceMode("light")` pins a mode: `toggle`
and `setMode` then change nothing until `forceMode(null)`.

Also in this change: the undefined `--sap-surface-muted`, `--sap-muted` and
`--sap-subtle` are replaced with `--sap-nested-bg`, `--sap-fg-muted` and
`--sap-fg-subtle` in the table card and cell-link styles, and the editable
grid's focus ring rule now out-ranks the preset's, so it applies.
`ReportSummaryStats` paints its `negative` tone with `--sap-numeric-negative`.
