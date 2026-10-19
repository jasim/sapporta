---
"@sapporta/server": minor
"@sapporta/shared": minor
---

Table search (`?q=`) now requires every word of the term rather than the
whole term as one substring. Each word may match a different searched value
of the row, including a child row or a referenced row's label, so
`grocery 2500` finds a journal whose description says grocery and whose entry
is 2500. A double-quoted phrase is one word. Repeated words count once, and
words after the first 16 are ignored. Number columns match a numeric word by
its stored value (`2,500` and `2500.00` match 2500, `250` does not) and are
skipped for other words; before, their text was matched as a substring. A
percentage column is matched by its stored fraction, so `0.25` finds 25%.
Primary keys are still matched as text, so `250` finds row 2500.
`searchWords(term)` in `@sapporta/shared` returns the words the search uses,
for highlighting them in the browser.
