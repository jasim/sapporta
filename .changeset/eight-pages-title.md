---
"@sapporta/frontend": patch
"@sapporta/server": patch
---

Name the browser tab after the current screen. `PageHeader` now sets the
document title to "<page> – <app name>" from the same `title` it displays, so
tables, reports, forms, and account pages each leave a readable entry in tab
lists and browser history. The app name comes from the loaded project info,
falling back to the title in index.html. Screens without the standard header
can call `usePageTitle`, and a header embedded in a panel can opt out with
`documentTitle={false}`.
