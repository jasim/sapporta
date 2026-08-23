# @sapporta/grid

## 0.4.1

### Patch Changes

- Improve port management of new projects
- Updated dependencies
  - @sapporta/shared@0.2.4
  - @sapporta/ui@0.2.12

## 0.4.0

### Minor Changes

- 6460e61: Remove the `@sapporta/grid/grid` subpath export. It exposed the same
  surface as the root export, differing only in the root's stylesheet side
  effect, so the package had two names for one module. Import from
  `@sapporta/grid` instead; the stylesheet can still be loaded separately
  via `@sapporta/grid/index.css`.

### Patch Changes

- Improvements after comparing agentic build of sample projects
- c46f748: Name the base grid engine layer GridCore and move it from `src/grid/` to
  `src/core/` so the directory tree shows the layer stack (GridCore →
  ColumnPreset). Internal move only: every export and subpath is unchanged.
- Updated dependencies [74ac829]
- Updated dependencies
  - @sapporta/ui@0.2.11
  - @sapporta/shared@0.2.3

## 0.3.2

### Patch Changes

- Add column width resize separators in reports, page titles for each page
- Updated dependencies
  - @sapporta/shared@0.2.2
  - @sapporta/ui@0.2.10

## 0.3.1

### Patch Changes

- Add drill-down links to reports
- Updated dependencies
  - @sapporta/shared@0.2.1
  - @sapporta/ui@0.2.9

## 0.3.0

### Minor Changes

- a1659d8: Let table pages control what happens when keyboard navigation reaches the edge
  of the loaded rows. The standard `TableGridView` now pauses on the visible
  Previous or Next pagination button before changing pages. Lower-level hooks
  and TGrid sessions remain policy-free unless the application provides a
  boundary handler. Activating the focused pagination button changes pages and
  returns focus to the first or last row of the newly loaded page. An arrow key
  on that pagination button returns browser focus to the grid without changing
  its cursor or selection.
- f1d56c6: Use Space as the canonical row-expansion command. Enter opens cells that are
  editable at runtime and otherwise runs their declared activation. Shift+Space
  toggles independent row selection, and readonly data sources no longer enter
  edit mode. Cell editing now starts through Enter, typing, or double-click.
  Pointer expansion runs only from the cell's expansion caret, so clicking its
  value keeps the normal cell interaction.

### Patch Changes

- Release coinciding with updated homepage design
- 30469d1: Keep cell-rendered React portal interactions outside grid cell, row, and copy
  context-menu handling.
- Updated dependencies [369f4d1]
- Updated dependencies [fd820be]
- Updated dependencies
- Updated dependencies [4e9bf62]
  - @sapporta/shared@0.2.0
  - @sapporta/ui@0.2.8

## 0.2.7

### Patch Changes

- Internal testing release
- Updated dependencies
  - @sapporta/shared@0.1.7
  - @sapporta/ui@0.2.7

## 0.2.6

### Patch Changes

- Release for homepage deployment pre-checks
- Updated dependencies
  - @sapporta/shared@0.1.6
  - @sapporta/ui@0.2.6

## 0.2.5

### Patch Changes

- first iteration of auth integration
- Updated dependencies
  - @sapporta/ui@0.2.5

## 0.2.4

### Patch Changes

- Create Dockerfile based deployment
- Updated dependencies
  - @sapporta/ui@0.2.4

## 0.2.3

### Patch Changes

- Update sapporta cli install
- Updated dependencies
  - @sapporta/ui@0.2.3

## 0.2.2

### Patch Changes

- 3d53017: Extract sapporta grid into separate package
- Updated dependencies [3d53017]
  - @sapporta/ui@0.2.2
