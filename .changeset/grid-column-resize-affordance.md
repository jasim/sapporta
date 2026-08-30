---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Column resizing is findable, and a dragged width is now honoured.

The drag handle painted nothing until the pointer was already on it, so the
only way to find a column edge was to sweep the header and watch the cursor.
Pointing anywhere at the header now draws every column boundary at once, and
the boundary being aimed at thickens into a full-height accent bar. The grab
area widened from 8px to 12px, straddling the boundary so it can be reached
from either side, and `--grid-column-resize-handle-width` sets it per grid
alongside the existing `--grid-column-resize-handle-color`,
`--grid-column-resize-handle-idle-color`, and
`--grid-column-resize-handle-hover-color`.

A dragged width was also being clamped to the column preset's own `min` and
`max`. Those bounds answer how to size a column nobody has sized, and reusing
them as resize limits left a `timestamp` column 16px of travel between its
floor and ceiling — the handle moved and the column sprang back. An explicit
width now overrides them and is bounded only by the grid's own `minPx` floor
(48px by default, set through `columnSizing.minPx`), which keeps a column from
being dragged away to nothing. Automatic sizing is unchanged: the preset
bounds still produce each column's `minmax()` track.

`clampColumnPixelWidth` no longer takes a column as its first argument, since
it no longer consults the column's preset. Call it as
`clampColumnPixelWidth(width, minPx)`.
