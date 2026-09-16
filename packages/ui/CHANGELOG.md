# @sapporta/ui

## 0.3.0

### Minor Changes

- d72e71a: `cn` now recognises the `text-sap-*`, `tracking-sap-*` and `h-sap-*` scales.
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

- b45d182: The primitives take their sizes from the token tiers instead of fixed pixels,
  so an app that redeclares the tiers reaches them. Buttons, inputs and the
  combobox are `h-sap-ctl` tall with `text-sap-emph` text; dialogs, sheets,
  popovers, menus and tooltips use the `rounded-lg`/`rounded-xl` radii and the
  new `shadow-sap-elevated`; badges, labels, titles and descriptions sit on the
  `sap-meta`, `sap-body` and `sap-display` tiers. In-flow surfaces (buttons,
  inputs, badges, the checkbox and switch) carry no shadow any more.

  `--sap-shadow-elevated` is the one shadow for floating layers, emitted as the
  `shadow-sap-elevated` utility. `--sap-kbd-inverted-bg` is now reachable as
  `bg-sap-kbd-inverted`, which the inverted `Kbd` uses instead of a fixed white
  wash. Destructive buttons and badges use `text-destructive-foreground`
  rather than white.

### Patch Changes

- Release

## 0.2.15

### Patch Changes

- release

## 0.2.14

### Patch Changes

- Release

## 0.2.13

### Patch Changes

- release
- 40cc6a8: with timezone improvements

## 0.2.12

### Patch Changes

- Improve port management of new projects

## 0.2.11

### Patch Changes

- 74ac829: Match the combobox popup width to the input it hangs from. The popup class
  used Tailwind v3 arbitrary-value syntax (`w-[--anchor-width]`), which v4 reads
  as a literal and compiles to `width: --anchor-width` — a declaration browsers
  discard — so every `LookupPicker` and Base UI `Combobox` dropdown collapsed to
  a narrow box under a full-width control.
- Improvements after comparing agentic build of sample projects

## 0.2.10

### Patch Changes

- Add column width resize separators in reports, page titles for each page

## 0.2.9

### Patch Changes

- Add drill-down links to reports

## 0.2.8

### Patch Changes

- Release coinciding with updated homepage design

## 0.2.7

### Patch Changes

- Internal testing release

## 0.2.6

### Patch Changes

- Release for homepage deployment pre-checks

## 0.2.5

### Patch Changes

- first iteration of auth integration

## 0.2.4

### Patch Changes

- Create Dockerfile based deployment

## 0.2.3

### Patch Changes

- Update sapporta cli install

## 0.2.2

### Patch Changes

- 3d53017: Extract sapporta grid into separate package

## 0.2.1

Initial public release of `@sapporta/ui` from the cleaned public repository history.
