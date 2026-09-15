---
"@sapporta/frontend": minor
---

An app can now compose its own shell from the sidebar primitives without
inheriting `AppShell`'s assumptions:

- `SidebarRegion` and `SidebarDrawer` take the width of what they hold
  instead of a fixed 240px. `SidebarShell` is still 240px, so the standard
  shell looks the same; an app's own sidebar sets its own width.
- `Toaster` is exported from `@sapporta/frontend/shell`. Sapporta's screens
  post toasts to the `sonner` instance this package bundles, so an app-owned
  shell renders this export once; a `Toaster` from the app's own copy of
  `sonner` would never show them. Render it above `BootLoader`: a workspace
  switch or a time zone change resets the schema store, the gate remounts
  everything under it, and a toast posted then needs an outlet that stayed
  mounted. (The standard `AppShell` sits under the gate in generated apps,
  so its Toaster misses those two toasts; a later change moves it.)
- `PageHeader` no longer depends on the shell's DOM order to keep clear of
  the content-side sidebar toggle. A shell sets `--sap-page-header-inset` on
  its scroll region while that control is present, and the header adds it to
  its leading padding. `AppShell` does this.
- `PageHeader`'s title and subtitle use the `sap-body` and `sap-menu` tiers
  instead of fixed pixel sizes, so a larger type scale reaches them.
- A custom `AccountMenu` trigger now reports `aria-expanded` from the menu's
  state; it was always `true`.
