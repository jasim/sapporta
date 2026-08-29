---
"@sapporta/frontend": minor
---

Report grids now render as stacked cards on narrow screens, the same
presentation table pages use. Below a 760px container width
`ReportGridDataset` switches from the tabular layout to cards; there is no
preference toggle — reports carry no per-table view preference, so the
container width alone picks the presentation.

Each level's first visible text column is stamped as the card title, and
since cards render no column header row, nested levels gain a small
uppercase level label in the header's place so a child level does not appear
as an unlabeled run of cards.
