# @sapporta/ui

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
