---
"@sapporta/ui": patch
---

Match the combobox popup width to the input it hangs from. The popup class
used Tailwind v3 arbitrary-value syntax (`w-[--anchor-width]`), which v4 reads
as a literal and compiles to `width: --anchor-width` — a declaration browsers
discard — so every `LookupPicker` and Base UI `Combobox` dropdown collapsed to
a narrow box under a full-width control.
