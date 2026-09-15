---
"@sapporta/grid": minor
---

The grid's sizing can be tuned from an app's stylesheet and its column widths
from props.

`.presetGrid` declared its cell padding, header weight and tracking,
row-header width, nested row height and nested indents on the element, so an
app could not change them from `:root`. Each now reads a `--sap-grid-*`
variable with the old value as the fallback; the names are listed at the top
of `sapporta-preset.module.css`.

`columnSizing.minWidths` raises the minimum width of a named column kind
(`numeric`, `timestamp`, `date`, `enum`, `foreignKey`, `compact`, `content`,
`fill`). The defaults were sized for 12px mono; at a larger scale a
lakh-style currency no longer fits the 112px numeric track, and
`{ numeric: 128 }` lifts it. Defaults are unchanged.

Also: the header menu and the select and lookup editors' popups use
`--sap-radius-lg` and `--sap-shadow-elevated`; the preset reads the
`--sap-radius*` tokens directly; and `data-grid-part` hooks exist for the
selection summary's content, labels and values, the text cell, and the level
status text.
