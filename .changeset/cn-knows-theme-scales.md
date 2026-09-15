---
"@sapporta/ui": minor
---

`cn` now recognises the `text-sap-*`, `tracking-sap-*` and `h-sap-*` scales.
Until now tailwind-merge read `text-sap-body` as a text colour, so
`cn("text-sap-body", "text-sap-fg")` dropped the size, and `h-9` next to
`h-sap-ctl` left both in place for CSS order to decide. Buttons, nav items,
report chrome and the `Kbd` chip all lost a size or a colour this way.

An app registers its own scales with `extendCn({ text: [...],
tracking: [...], spacing: [...] })` once at startup, so its custom sizes merge
correctly inside Sapporta's components too.

Also in this change:

- `--border` and `--color-border` exist, and a layered base rule sets
  `border-color: var(--border)`. Until now a `border` utility without a colour
  drew in the text colour, so dialogs, popovers, tooltips and context menus had
  ink borders, and the context menu separator's `bg-border` produced nothing.
- `--accent`, the hover wash behind `bg-accent`, follows `--sap-row-hover`
  instead of `--sap-active-nav-bg`, so restyling the active navigation item
  no longer changes every hover.
- `--sap-numeric-negative` paints negative figures. It follows
  `--sap-negative` unless an app sets it, so a ledger whose money out is not a
  problem can keep errors red and figures in ink.
- The radii are `--sap-radius`, `--sap-radius-sm`, `--sap-radius-lg` and
  `--sap-radius-xl`; the `--radius*` names stay as aliases. The `@theme`
  block used to point `--radius-sm` at itself.
