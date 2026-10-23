---
"@sapporta/shared": minor
"@sapporta/server": minor
"@sapporta/frontend": patch
---

An empty filter value on a `number`, `date` or `timestamp` column is now a
`bad_value`. It used to be read as `NULL` and compared with `=` or `>=`, which
matched no rows without an error. `filter[amount][eq]=` now returns `400`; match
a missing value with `is`. On a `text` column an empty value still matches
empty text. `parseFilterValue()` throws `TypedFilterParseError` for an empty
or blank string on those kinds instead of returning `null`.

`NewFilterCondition` is removed. `encodeFilters()`, `encodeFilterValue()` and
`decodeFilterObject()` use `FilterDraftCondition`, so an `in`/`nin` list may
hold numbers, which are written as strings. `POLARITIES` lists the `is`
operator's values.

Clearing one date in a date-range filter card removes that bound and keeps
the other, instead of sending an empty date.
