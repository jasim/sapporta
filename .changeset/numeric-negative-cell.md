---
"@sapporta/grid": patch
---

`NumericCell` paints `colorRule: "negative"` and negative `signed` values with
`--sap-numeric-negative` instead of `--sap-negative`, so an app can colour
negative figures apart from errors. The default value is unchanged.
