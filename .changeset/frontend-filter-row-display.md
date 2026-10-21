---
"@sapporta/frontend": minor
---

Filters draw the rows they pick with the table's row display, so two rows
with the same name can be told apart. Options in a filter's checklist show
the table's caption under the label, as pickers do. A filter chip draws each
chosen row with the label slot (`context.surface === "chip"`); by default it
shows the label alone, with the caption as its tooltip.
