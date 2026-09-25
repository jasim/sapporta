---
"@sapporta/ui": minor
"@sapporta/frontend": patch
---

The navigation sidebar is quieter. It sits on a warm tone with no line at its
edge. Its rows are 14px grey labels with 18px icons, sitting edge to edge.
Hover shows at once instead of fading in. The current page shows in darker
text on a faint wash, without turning bold. Section labels are small grey
sentence case instead of spaced capitals.

The colours are new tokens that an app can redeclare: `--sap-nav-bg`,
`--sap-nav-fg`, `--sap-nav-icon`, `--sap-nav-section`, `--sap-nav-hover-bg`
and `--sap-nav-selected-bg`, with `bg-sap-nav`, `text-sap-nav-fg` and the
rest as utilities. `--sap-sidebar` and `--sap-active-nav-bg` keep their
values and their other uses, such as grid headers, the status bar and
account avatars.
