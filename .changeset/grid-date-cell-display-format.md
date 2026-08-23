---
"@sapporta/shared": minor
"@sapporta/grid": minor
"@sapporta/frontend": minor
---

Date and timestamp cells now read as `2026-08-23` and `2026-08-23 16:38`
instead of the raw wire value. A timestamp column printed its stored form —
`2026-08-23T11:08:00Z` — which is 144px of monospace text in a track that
allows 108px, so the column was both hard to scan and clipped.

Timestamp columns are their own column preset, `columnPreset.timestamp()`, with
their own default width. Which of the two shapes a column reads in comes from
the column's declared kind rather than from the value in the cell, so a column
reads the same way in every row even where the values underneath it vary. Table
and report columns pick the preset from the kind they already declare, and
schema-declared sizing still wins where it is present.

`formatTemporalForDisplay()` in `@sapporta/shared/temporal` is the display half
of the codecs that already sit there: it drops the `T`, the `Z`, and the
seconds, and resolves an instant to the reader's own time zone — the same zone
the input codecs beside it read and write in. It takes the precision the column
asks for, and precision is a ceiling: a plain date in a timestamp column stays a
date rather than gaining a midnight. A value in neither canonical shape is
reported as `null` so the caller can show the text exactly as it arrived rather
than invent a date from it.

Hovering a timestamp cell shows the moment the cell text leaves out —
`2026-08-24 02:00:00 (UTC+05:30)` — so that two rows a few seconds apart can be
told apart, and so that the zone a cell is printed on is recoverable from the
cell itself. The description is resolved on first hover, not on render.

Date and timestamp filters on timestamp columns work again. A date-only bound
reached the instant parser as typed and was rejected — `Temporal.Instant
requires a time zone offset` — out of a change handler, so a range filter on a
timestamp column could not be edited at all. A date control on a timestamp
column now names a local day, and the operator picks the edge of that day the
bound sits on: `on or after` and `before` read its first instant, `after` and
`on or before` its last. `on` and `not on` are no longer offered for timestamp
columns, because a day is a range of instants and the condition grammar has no
way to say so in a single condition.
