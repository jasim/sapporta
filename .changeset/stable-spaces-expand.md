---
"@sapporta/grid": minor
"@sapporta/frontend": patch
---

Use Space as the canonical row-expansion command. Enter opens cells that are
editable at runtime and otherwise runs their declared activation. Shift+Space
toggles independent row selection, and readonly data sources no longer enter
edit mode. Cell editing now starts through Enter, typing, or double-click.
Pointer expansion runs only from the cell's expansion caret, so clicking its
value keeps the normal cell interaction.
