---
"@sapporta/ui": minor
---

The primitives take their sizes from the token tiers instead of fixed pixels,
so an app that redeclares the tiers reaches them. Buttons, inputs and the
combobox are `h-sap-ctl` tall with `text-sap-emph` text; dialogs, sheets,
popovers, menus and tooltips use the `rounded-lg`/`rounded-xl` radii and the
new `shadow-sap-elevated`; badges, labels, titles and descriptions sit on the
`sap-meta`, `sap-body` and `sap-display` tiers. In-flow surfaces (buttons,
inputs, badges, the checkbox and switch) carry no shadow any more.

`--sap-shadow-elevated` is the one shadow for floating layers, emitted as the
`shadow-sap-elevated` utility. `--sap-kbd-inverted-bg` is now reachable as
`bg-sap-kbd-inverted`, which the inverted `Kbd` uses instead of a fixed white
wash. Destructive buttons and badges use `text-destructive-foreground`
rather than white.
