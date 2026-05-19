# @sapporta/ui

React admin UI for Sapporta projects.

## Stack

Vite + React 19 + Tailwind v4 + shadcn/ui + Zustand

## Custom Views — UI Routing

Custom views are routed at `/p/:projectId/views/:viewName`.

The view component (default export from the `.tsx` file) runs in the browser.

## Vite Plugin: sapportaViews

The `vite-plugin-sapporta-views.ts` plugin auto-discovers project `views/` directories from the registry at startup, generating a virtual module (`virtual:sapporta-views`) with lazy `import()` statements.
