---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Tapping a card on a narrow table page now opens a record detail sheet: a
bottom sheet listing every visible field of the row as label/value lines.
Grid cells could already edit inline, but the cell editor overlay is a
pointer-and-keyboard workflow that positions poorly on a phone, and date and
timestamp columns had no cell editor at all — so on mobile a record could
neither be read in full nor edited comfortably.

Fields in the sheet edit through the same form controls as the new-record
form (text, number, date, timestamp, checkbox, select, and foreign-key
lookups), and each save flows through the grid's cell patch path, so
optimistic updates, custom `saveCellValue` handlers, and failure banners
behave exactly like inline grid edits. The sheet reads the displayed row
live and closes itself when the row leaves the page.

The tap arrives through a new default table interaction,
`CELL_GRID_WITH_ROW_CLICK_ACTIVATION`: plain click now also emits a semantic
row activation. Pointer and keyboard behavior is otherwise unchanged — the
click still places the cell cursor first — and wide layouts ignore the
event, so desktop tables are untouched. A TGrid definition that passes its
own `interaction` keeps it, as before.

Narrow cards also tightened up around the sheet: a card title that hosts the
row-expansion chevron may wrap to two lines before clamping instead of
truncating at one, and secondary fields whose value is empty are skipped
entirely — the sheet now shows the full field list, so an empty line in the
card only cost density. Only default preset cells are skipped; client
columns and columns with a custom `renderCell` always render, since they can
draw content for an empty value.
