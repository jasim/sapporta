---
"@sapporta/frontend": patch
---

The grid's cards presentation is denser and typographically consistent.
Field rows drop the tabular 28px cell height for a compact ~22px line,
labels sit in a fixed-width column at a uniform weight and color, and
inline data values (ids, dates, numbers) take the body font size while
keeping their mono family. The primary-key value now reads like any other
field — left-aligned in the value column with the expansion chevron
directly after it — instead of the tabular grid's right-aligned identifier
treatment, and the selection gutter's idle gray wash is transparent in
cards, painting only on hover, selection, and focus.
