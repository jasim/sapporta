# @sapporta/ui

Reusable React UI primitives for Sapporta projects.

## Stack

Vite + React 19 + Tailwind v4 + shadcn/ui

## Package Boundary

`@sapporta/ui` owns generic primitives, composites, hooks, utilities, and the
shared CSS token entry at `@sapporta/ui/index.css`.

Admin routes, table pages, reports, shell, and schema catalog code live in
`@sapporta/frontend`. Grid runtime and column presets live in `@sapporta/grid`.
