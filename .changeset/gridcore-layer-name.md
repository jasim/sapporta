---
"@sapporta/grid": patch
---

Name the base grid engine layer GridCore and move it from `src/grid/` to
`src/core/` so the directory tree shows the layer stack (GridCore →
ColumnPreset). Internal move only: every export and subpath is unchanged.
