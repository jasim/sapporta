---
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Two cards-presentation fixes for grids, and the grid presentation is now
a required value.

The primary-key cell no longer paints row-header chrome in cards. Standard
tables use the pk column as a data-backed row header, and cards kept its
tabular treatment: a tinted background — which in a full-width card field
looked identical to the selected-cell background — and a click that selected
the whole row while every other cell click placed the cell cursor. In cards
that column now renders as a plain field: no tinted band, and clicking it
selects the cell like any other. A selected row still shows through the
card-level selected background, and the structural checkbox gutter
("empty-selectable-cell") keeps its meaning in every presentation. On touch,
tapping the Id chip no longer selects the row and surfaces the delete
toolbar.

Keyboard traversal in cards now follows the rendered order. A card leads
with its title column, but arrows and Tab walked the columns in schema
order, so the title — visually first — was reached last and vertical
movement felt shuffled. Movement now resolves against the order the active
presentation renders (the presentation travels with each keystroke and
editor commit, like a modifier key): cards traversal leads with the title
column before the remaining columns in schema order, and moving past the
last field lands on the next card's title. Tabular grids are unchanged.

The presentation is a required value everywhere it travels. It used to be
an optional parameter that silently fell back to `"tabular"`, so a call
site that forgot to pass it navigated a cards grid in the spreadsheet's
column order. Every boundary that carries a presentation (`handleKey`,
`commitEdit`, `handleCellPointer`, `navigateCell`, and the `presentation`
prop on `Grid`, `GridLevel`, and `TGrid`) now requires the caller to name
the presentation it renders, so a missing value is a type error rather
than a wrong default.
